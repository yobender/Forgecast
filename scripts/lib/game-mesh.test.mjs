import test from 'node:test'
import assert from 'node:assert/strict'
import { Document, NodeIO } from '@gltf-transform/core'
import { SphereGeometry } from 'three'
import { processGameMesh, srgbToLinear, validateGameOptions } from './game-mesh.mjs'

const io = new NodeIO()
const defaults = { operation: 'optimize', targetTriangles: 10000, protection: 'balanced', legacyMiniColor: true }
async function fixture({ disconnected = false, color = true } = {}) {
  const doc = new Document(), buffer = doc.createBuffer()
  const geo = new SphereGeometry(1, 128, 80)
  const primitive = doc.createPrimitive().setAttribute('POSITION', doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(geo.attributes.position.array.slice()))
  primitive.setIndices(doc.createAccessor().setBuffer(buffer).setType('SCALAR').setArray(Uint32Array.from(geo.index.array)))
  if (disconnected) {
    const positions = new Float32Array(12000 * 9)
    for (let i = 0; i < 12000; i++) positions.set([i,0,0, i+0.1,1,0, i+0.2,0,1], i * 9)
    primitive.getAttribute('POSITION').setArray(positions)
    primitive.getIndices().setArray(Uint32Array.from({length:36000}, (_, i) => i))
  }
  const count = primitive.getAttribute('POSITION').getCount()
  if (color) primitive.setAttribute('COLOR_0', doc.createAccessor().setBuffer(buffer).setType('VEC4').setNormalized(true).setArray(Uint8Array.from({length:count*4}, (_, i) => [128,64,32,200][i%4])))
  doc.createScene().addChild(doc.createNode().setTranslation([3,4,5]).setMesh(doc.createMesh().addPrimitive(primitive)))
  return io.writeBinary(doc)
}

test('reduces triangles/vertices, preserves source bytes and transforms, exports linear RGBA and normals', async () => {
  const source = await fixture(), unchanged = source.slice()
  const inputDoc = await io.readBinary(source)
  const inputPositions = inputDoc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION').getArray()
  const sourcePositionKeys = new Set(Array.from({length: inputPositions.length / 3}, (_, i) => `${inputPositions[i*3]},${inputPositions[i*3+1]},${inputPositions[i*3+2]}`))
  const result = await processGameMesh(source, defaults)
  assert.deepEqual(source, unchanged)
  assert.ok(result.stats.outputTriangles <= 10000)
  assert.ok(result.stats.outputVertices < result.stats.inputVertices)
  assert.deepEqual(result.stats.sourceFeatures, { normals: false, vertexColors: true, texcoords: false, baseColorTexture: false, normalTexture: false })
  const output = await io.readBinary(result.bytes), primitive = output.getRoot().listMeshes()[0].listPrimitives()[0]
  assert.deepEqual(output.getRoot().listNodes()[0].getTranslation(), [3,4,5])
  assert.ok(primitive.getAttribute('NORMAL'))
  const rgba = primitive.getAttribute('COLOR_0').getElement(0, [])
  assert.ok(rgba.every((value) => value >= 0 && value <= 1))
  assert.ok(Math.abs(rgba[0] - srgbToLinear(128/255)) < 0.08)
  const outputPositions = primitive.getAttribute('POSITION').getArray()
  assert.ok(Array.from({length:outputPositions.length/3},(_,i)=>`${outputPositions[i*3]},${outputPositions[i*3+1]},${outputPositions[i*3+2]}`).some((key)=>!sourcePositionKeys.has(key)), 'updated simplifier should relocate surviving vertices')
  assert.equal(primitive.getExtras().forgecastVertexColorSpace, 'linear')
  assert.equal(primitive.getIndices().getCount()/3, result.stats.outputTriangles)
  for (const attr of primitive.listAttributes()) assert.equal(attr.getCount(), result.stats.outputVertices)
})

test('color-only copy keeps geometry and does not apply conversion twice', async () => {
  const source = await fixture()
  const first = await processGameMesh(source, {...defaults,operation:'color'})
  const second = await processGameMesh(first.bytes, {...defaults,operation:'color'})
  assert.equal(first.stats.outputTriangles, first.stats.inputTriangles)
  assert.equal(second.stats.correctedColors, false)
  const a = (await io.readBinary(first.bytes)).getRoot().listMeshes()[0].listPrimitives()[0]
  const b = (await io.readBinary(second.bytes)).getRoot().listMeshes()[0].listPrimitives()[0]
  assert.deepEqual(a.getAttribute('COLOR_0').getArray(), b.getAttribute('COLOR_0').getArray())
  assert.deepEqual(a.getAttribute('POSITION').getArray(), b.getAttribute('POSITION').getArray())
})

test('native linear vertex colors are not darkened', async () => {
  const result = await processGameMesh(await fixture(), {...defaults,operation:'color',legacyMiniColor:false})
  const p = (await io.readBinary(result.bytes)).getRoot().listMeshes()[0].listPrimitives()[0]
  assert.equal(result.stats.correctedColors, false)
  assert.ok(Math.abs(p.getAttribute('COLOR_0').getElement(0, [])[0]-128/255)<1e-6)
})

test('refuses destructive fallback when topology prevents reaching the budget', async () => {
  const result = await processGameMesh(await fixture({disconnected:true}), defaults)
  assert.equal(result.stats.targetMet, false)
  assert.ok(result.stats.outputTriangles > 10000)
  assert.ok(result.stats.warnings[0].includes('stopped above'))
})

test('uncolored sources stay uncolored', async () => {
  const result = await processGameMesh(await fixture({color:false}), defaults)
  const p = (await io.readBinary(result.bytes)).getRoot().listMeshes()[0].listPrimitives()[0]
  assert.equal(p.getAttribute('COLOR_0'), null)
})

test('rejects invalid options and malformed input', async () => {
  assert.throws(() => validateGameOptions({...defaults,targetTriangles:-1}))
  assert.throws(() => validateGameOptions({...defaults,protection:'sloppy'}))
  assert.throws(() => validateGameOptions({...defaults,legacyMiniColor:undefined}))
  await assert.rejects(processGameMesh(new Uint8Array(20),defaults))
})

test('preserves embedded texture bytes, UVs, PBR factors and material boundaries', async () => {
  const doc = await io.readBinary(await fixture())
  const primitive = doc.getRoot().listMeshes()[0].listPrimitives()[0]
  const buffer = doc.getRoot().listBuffers()[0]
  const uv = new SphereGeometry(1,128,80).attributes.uv.array.slice()
  primitive.setAttribute('TEXCOORD_0', doc.createAccessor().setBuffer(buffer).setType('VEC2').setArray(uv))
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))
  const texture = doc.createTexture('Original atlas').setMimeType('image/png').setImage(png)
  const material = doc.createMaterial('Original PBR').setBaseColorTexture(texture).setBaseColorFactor([.7,.5,.3,.8]).setRoughnessFactor(.6).setMetallicFactor(.4).setAlphaMode('BLEND').setDoubleSided(true)
  primitive.setMaterial(material)
  const result = await processGameMesh(await io.writeBinary(doc), {...defaults,legacyMiniColor:false})
  const output = await io.readBinary(result.bytes), p = output.getRoot().listMeshes()[0].listPrimitives()[0]
  const actual = p.getMaterial()
  assert.deepEqual(actual.getBaseColorFactor(), [.7,.5,.3,.8])
  assert.equal(actual.getRoughnessFactor(), .6)
  assert.equal(actual.getMetallicFactor(), .4)
  assert.equal(actual.getAlphaMode(), 'BLEND')
  assert.equal(actual.getDoubleSided(), true)
  assert.deepEqual(actual.getBaseColorTexture().getImage(), png)
  assert.equal(result.stats.sourceFeatures.baseColorTexture, true)
  assert.equal(result.stats.sourceFeatures.texcoords, true)
  assert.equal(p.getAttribute('TEXCOORD_0').getCount(), result.stats.outputVertices)
  const outputUV = p.getAttribute('TEXCOORD_0').getArray()
  for (const value of outputUV) assert.ok(Number.isFinite(value) && value >= -0.01 && value <= 1.01)
  assert.ok(outputUV.some((value, i) => Math.abs(value - uv[i]) > 1e-7), 'UVs should be updated with relocated vertices')
})

test('rejects animations and instancing without modifying the source', async () => {
  const doc = await io.readBinary(await fixture())
  doc.getRoot().listScenes()[0].addChild(doc.createNode().setMesh(doc.getRoot().listMeshes()[0]))
  const source = await io.writeBinary(doc), unchanged = source.slice()
  await assert.rejects(processGameMesh(source, defaults), /Instanced/)
  assert.deepEqual(source, unchanged)
  doc.createAnimation('Must not discard')
  await assert.rejects(processGameMesh(await io.writeBinary(doc), defaults), /animated/)
})
