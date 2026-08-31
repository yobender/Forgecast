import { NodeIO } from '@gltf-transform/core'
import { MeshoptSimplifier } from 'meshoptimizer'

export const GAME_BUDGETS = [10000, 25000, 50000, 100000]
export const ERROR_LIMITS = { strict: 0.005, balanced: 0.02, flexible: 0.05 }
export const srgbToLinear = (value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4

function floats(accessor) {
  const size = accessor.getElementSize()
  const result = new Float32Array(accessor.getCount() * size)
  const element = []
  for (let i = 0; i < accessor.getCount(); i++) {
    accessor.getElement(i, element)
    result.set(element, i * size)
  }
  return result
}

function computeNormals(positions, indices) {
  const normals = new Float32Array(positions.length)
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    for (const v of [a, b, c]) { normals[v] += nx; normals[v + 1] += ny; normals[v + 2] += nz }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1
    normals[i] /= length; normals[i + 1] /= length; normals[i + 2] /= length
  }
  return normals
}

function normalizeUpdatedChannel(values, stride, offset, size, semantic) {
  for (let vertex = 0; vertex < values.length / stride; vertex++) {
    const start = vertex * stride + offset
    if (semantic === 'COLOR_0') {
      for (let c = 0; c < size; c++) values[start + c] = Math.max(0, Math.min(1, values[start + c]))
    } else if (semantic === 'NORMAL' || semantic === 'TANGENT') {
      const length = Math.hypot(values[start], values[start + 1], values[start + 2]) || 1
      values[start] /= length; values[start + 1] /= length; values[start + 2] /= length
      if (semantic === 'TANGENT' && size === 4) values[start + 3] = values[start + 3] < 0 ? -1 : 1
    }
  }
}

export function validateGameOptions(options) {
  if (!['optimize', 'color'].includes(options.operation)) throw new Error('Unknown mesh operation')
  if (options.operation === 'optimize' && !GAME_BUDGETS.includes(options.targetTriangles)) throw new Error('Choose a supported triangle budget')
  if (options.operation === 'optimize' && !Object.hasOwn(ERROR_LIMITS, options.protection)) throw new Error('Unknown detail-protection level')
  if (typeof options.legacyMiniColor !== 'boolean') throw new Error('Color source must be specified')
}

export async function processGameMesh(bytes, options, progress = () => {}) {
  validateGameOptions(options)
  const io = new NodeIO()
  progress('Reading retained source')
  const jsonDoc = await io.binaryToJSON(bytes)
  const json = jsonDoc.json
  // Never silently discard animation, extension semantics, or load outside resources.
  if (json.extensionsUsed?.length) throw new Error('This optimizer currently supports standard static GLBs only; extended/compressed GLBs need a dedicated conversion first.')
  if (json.animations?.length || json.skins?.length) throw new Error('Rigged/animated assets need animation-aware optimization; the source has not been changed.')
  if (json.buffers?.some((b) => b.uri) || json.images?.some((i) => i.uri)) throw new Error('Only self-contained GLB resources are supported')
  const document = await io.readJSON(jsonDoc)
  const root = document.getRoot()
  const meshNodes = root.listNodes().filter((node) => node.getMesh())
  if (new Set(meshNodes.map((node) => node.getMesh())).size !== meshNodes.length) throw new Error('Instanced meshes require per-instance budget handling; source unchanged.')
  const primitives = root.listMeshes().flatMap((mesh) => mesh.listPrimitives())
  if (!primitives.length) throw new Error('No mesh geometry in the GLB')
  const buffer = root.listBuffers()[0] || document.createBuffer()
  const data = primitives.map((primitive) => {
    if (primitive.getMode() !== 4 || primitive.listTargets().length) throw new Error('Only static triangle primitives are supported')
    const position = primitive.getAttribute('POSITION')
    if (!position || position.getType() !== 'VEC3') throw new Error('Invalid mesh positions')
    const positions = floats(position)
    const indices = primitive.getIndices() ? Uint32Array.from(primitive.getIndices().getArray()) : Uint32Array.from({ length: position.getCount() }, (_, i) => i)
    if (!indices.length || indices.length % 3 || positions.some((v) => !Number.isFinite(v)) || indices.some((i) => i >= position.getCount())) throw new Error('Invalid triangle geometry')
    for (const attribute of primitive.listAttributes()) if (attribute.getCount() !== position.getCount()) throw new Error('Vertex attribute count mismatch')
    return { primitive, positions, indices }
  })
  const inputTriangles = data.reduce((sum, item) => sum + item.indices.length / 3, 0)
  const inputVertices = data.reduce((sum, item) => sum + item.positions.length / 3, 0)
  const sourceFeatures = {
    normals: primitives.every((primitive) => Boolean(primitive.getAttribute('NORMAL'))),
    vertexColors: primitives.some((primitive) => Boolean(primitive.getAttribute('COLOR_0'))),
    texcoords: primitives.every((primitive) => Boolean(primitive.getAttribute('TEXCOORD_0'))),
    baseColorTexture: primitives.some((primitive) => Boolean(primitive.getMaterial()?.getBaseColorTexture())),
    normalTexture: primitives.some((primitive) => Boolean(primitive.getMaterial()?.getNormalTexture())),
  }
  let correctedColors = false
  progress('Checking color encoding')
  for (const { primitive } of data) {
    const color = primitive.getAttribute('COLOR_0')
    const alreadyLinear = primitive.getExtras().forgecastVertexColorSpace === 'linear'
    if (color && options.legacyMiniColor && !alreadyLinear) {
      const values = floats(color), size = color.getElementSize()
      if (![3, 4].includes(size)) throw new Error('Invalid vertex colors')
      for (let i = 0; i < values.length; i += size) for (let c = 0; c < 3; c++) values[i + c] = srgbToLinear(Math.max(0, Math.min(1, values[i + c])))
      primitive.setAttribute('COLOR_0', document.createAccessor().setBuffer(buffer).setType(color.getType()).setArray(values))
      correctedColors = true
    }
    if (color && (options.legacyMiniColor || alreadyLinear)) {
      primitive.setExtras({ ...primitive.getExtras(), forgecastVertexColorSpace: 'linear' })
      if (!primitive.getMaterial()) primitive.setMaterial(document.createMaterial('Reference color').setMetallicFactor(0.08).setRoughnessFactor(0.82))
    }
  }
  // The viewer reads this marker; existing native linear exports are never converted twice.
  for (const scene of root.listScenes()) scene.setExtras({ ...scene.getExtras(), forgecastVertexColorSpace: 'linear' })

  let maxAppearanceError = 0
  if (options.operation === 'optimize') {
    await MeshoptSimplifier.ready
    MeshoptSimplifier.useExperimentalFeatures = true // Enables attribute-aware vertex relocation in meshoptimizer 1.2.
    for (let p = 0; p < data.length; p++) {
      const { primitive, positions, indices } = data[p]
      progress(`Reducing mesh ${p + 1}/${data.length} · preserving normals and color boundaries`)
      const generatedNormals = !primitive.getAttribute('NORMAL')
      if (generatedNormals) primitive.setAttribute('NORMAL', document.createAccessor().setBuffer(buffer).setType('VEC3').setArray(computeNormals(positions, indices)))
      const channels = ['NORMAL', 'COLOR_0', 'TEXCOORD_0', 'TEXCOORD_1', 'TANGENT'].filter((key) => primitive.getAttribute(key)).map((key) => ({ key, accessor: primitive.getAttribute(key), offset: 0 }))
      const stride = channels.reduce((sum, channel) => sum + channel.accessor.getElementSize(), 0)
      const attributes = new Float32Array(positions.length / 3 * stride)
      const weights = []
      let offset = 0
      for (const channel of channels) {
        const { key, accessor } = channel
        channel.offset = offset
        const array = floats(accessor), size = accessor.getElementSize()
        for (let v = 0; v < accessor.getCount(); v++) for (let c = 0; c < size; c++) attributes[v * stride + offset + c] = array[v * size + c]
        weights.push(...Array(size).fill(key === 'NORMAL' ? 0.5 : key === 'COLOR_0' ? 2 : 0.5))
        offset += size
      }
      const share = Math.max(1, Math.floor(options.targetTriangles * (indices.length / 3) / inputTriangles))
      const target = Math.min(indices.length, share * 3)
      let simplified, error
      if (target < indices.length) {
        // Unlike simplifyWithAttributes, the update variant moves surviving
        // vertices and attributes to minimize error. This materially improves
        // large flat/curved forms at aggressive game budgets.
        const updatedIndices = indices.slice()
        const [indexCount, resultError] = MeshoptSimplifier.simplifyWithUpdate(updatedIndices, positions, 3, attributes, stride, weights, null, target, ERROR_LIMITS[options.protection], ['LockBorder', 'Permissive', 'RegularizeLight'])
        simplified = updatedIndices.slice(0, indexCount)
        error = resultError
        for (const channel of channels) normalizeUpdatedChannel(attributes, stride, channel.offset, channel.accessor.getElementSize(), channel.key)
      } else {
        simplified = indices.slice()
        error = 0
      }
      maxAppearanceError = Math.max(maxAppearanceError, error)
      // compactMesh rewrites the index buffer, returning old -> new vertex mapping.
      const [remap, vertexCount] = MeshoptSimplifier.compactMesh(simplified)
      for (const semantic of primitive.listSemantics()) {
        const attribute = primitive.getAttribute(semantic)
        const size = attribute.getElementSize(), channel = channels.find((item) => item.key === semantic)
        const updated = semantic === 'POSITION' || channel
        const input = semantic === 'POSITION' ? positions : channel ? attributes : attribute.getArray()
        const output = updated ? new Float32Array(vertexCount * size) : new input.constructor(vertexCount * size)
        for (let i = 0; i < remap.length; i++) if (remap[i] !== 0xffffffff) for (let c = 0; c < size; c++) {
          const sourceOffset = channel ? i * stride + channel.offset + c : i * size + c
          output[remap[i] * size + c] = input[sourceOffset]
        }
        primitive.setAttribute(semantic, document.createAccessor().setBuffer(buffer).setType(attribute.getType()).setNormalized(updated ? false : attribute.getNormalized()).setArray(output))
      }
      primitive.setIndices(document.createAccessor().setBuffer(buffer).setType('SCALAR').setArray(vertexCount <= 65535 ? Uint16Array.from(simplified) : simplified))
    }
  }
  const used = new Set(primitives.flatMap((primitive) => [...primitive.listAttributes(), primitive.getIndices()].filter(Boolean)))
  for (const accessor of root.listAccessors()) if (!used.has(accessor)) accessor.dispose()
  progress('Writing separate GLB and verifying triangle count')
  const output = await io.writeBinary(document)
  const outputTriangles = primitives.reduce((sum, primitive) => sum + (primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION').getCount()) / 3, 0)
  const outputVertices = primitives.reduce((sum, primitive) => sum + primitive.getAttribute('POSITION').getCount(), 0)
  const warnings = []
  if (options.operation === 'optimize' && outputTriangles > options.targetTriangles) warnings.push('Detail/topology protection stopped above the requested budget. Try Flexible protection or a higher triangle target; no destructive fallback was used.')
  if (options.operation === 'optimize' && !sourceFeatures.normalTexture) warnings.push('The source has no baked normal map, so tiny relief cannot survive large triangle reductions yet. Inspect this copy before using it in a game; it is not animation-ready retopology.')
  return { bytes: output, stats: { inputTriangles, outputTriangles, inputVertices, outputVertices, inputBytes: bytes.length, outputBytes: output.length, targetTriangles: options.operation === 'optimize' ? options.targetTriangles : inputTriangles, targetMet: options.operation !== 'optimize' || outputTriangles <= options.targetTriangles, maxAppearanceError, correctedColors, colorSpace: 'linear', reductionPercent: 100 * (1 - outputTriangles / inputTriangles), sourceFeatures, warnings } }
}
