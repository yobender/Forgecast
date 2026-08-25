import { Environment, Grid, OrbitControls, useGLTF } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { forwardRef, Suspense, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { ArtStyle, AssetType } from '../types'

export interface AssetViewerHandle {
  getObject: () => THREE.Object3D | null
}

const PALETTES: Record<ArtStyle, [string, string, string]> = {
  'polygon-game': ['#4f967d', '#e0ad57', '#263c38'],
  sculpted: ['#9b6c46', '#d4975d', '#4d2f22'],
  'hand-painted': ['#23828a', '#efaf42', '#132e3c'],
  'low-poly': ['#6ab47b', '#f1c35b', '#263c31'],
  'dark-fantasy': ['#3b4656', '#be4c37', '#171a20'],
  toon: ['#6d70e8', '#f08f58', '#292a4a'],
}

function Material({ color, roughness = 0.7 }: { color: string; roughness?: number }) {
  return <meshStandardMaterial color={color} roughness={roughness} metalness={0.08} />
}

const WIREFRAME_OVERLAY = '__forgecast_wireframe__'
const PBR_TEXTURE_SIZE = 2048

type SurfaceKind = 'metal' | 'leather' | 'crystal'

interface SurfaceTextures {
  detail: THREE.CanvasTexture
  normal: THREE.CanvasTexture
  orm: THREE.CanvasTexture
}

const surfaceTextureCache = new Map<SurfaceKind, SurfaceTextures>()

function makeSurfaceTextures(kind: SurfaceKind): SurfaceTextures {
  const cached = surfaceTextureCache.get(kind)
  if (cached) return cached

  const detailCanvas = document.createElement('canvas')
  const normalCanvas = document.createElement('canvas')
  const ormCanvas = document.createElement('canvas')
  detailCanvas.width = normalCanvas.width = ormCanvas.width = PBR_TEXTURE_SIZE
  detailCanvas.height = normalCanvas.height = ormCanvas.height = PBR_TEXTURE_SIZE
  const detailContext = detailCanvas.getContext('2d')!
  const normalContext = normalCanvas.getContext('2d')!
  const ormContext = ormCanvas.getContext('2d')!
  const detailImage = detailContext.createImageData(PBR_TEXTURE_SIZE, PBR_TEXTURE_SIZE)
  const normalImage = normalContext.createImageData(PBR_TEXTURE_SIZE, PBR_TEXTURE_SIZE)
  const ormImage = ormContext.createImageData(PBR_TEXTURE_SIZE, PBR_TEXTURE_SIZE)

  for (let y = 0; y < PBR_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < PBR_TEXTURE_SIZE; x += 1) {
      const pixel = (y * PBR_TEXTURE_SIZE + x) * 4
      const grain = ((x * 37) ^ (y * 73) ^ ((x * y) >>> 4)) & 255
      const fine = grain - 127
      let nx = fine * 0.12
      let ny = (((x * 19) ^ (y * 43)) & 255) * 0.12 - 15
      let tint = 238 + fine * 0.035
      let roughness = 169 + fine * 0.055
      let metalness = 82

      if (kind === 'leather') {
        const fiber = ((x + y * 3) % 83) - 41
        const wrap = ((x + y) % 257) < 7 ? -22 : 0
        nx = fine * 0.09 + fiber * 0.3
        ny = fine * 0.08 - fiber * 0.12 + wrap
        tint = 232 + fine * 0.055 + wrap * 0.25
        roughness = 235 + fine * 0.025
        metalness = 3
      } else if (kind === 'crystal') {
        const facetX = Math.abs((x % 211) - 105) - 52
        const facetY = Math.abs((y % 173) - 86) - 43
        nx = facetX * 0.34 + fine * 0.05
        ny = facetY * 0.34 + fine * 0.05
        tint = 242 + ((x + y) % 97 < 4 ? 11 : 0)
        roughness = 72 + Math.abs(fine) * 0.12
        metalness = 10
      } else {
        const scratch = ((x * 3 + y) % 401) < 3 ? -25 : 0
        nx += scratch * 0.4
        ny -= scratch * 0.2
        tint += scratch * 0.16
        roughness += scratch * 0.28
      }

      const normalZ = 244
      detailImage.data[pixel] = Math.max(0, Math.min(255, tint))
      detailImage.data[pixel + 1] = Math.max(0, Math.min(255, tint))
      detailImage.data[pixel + 2] = Math.max(0, Math.min(255, tint))
      detailImage.data[pixel + 3] = 255
      normalImage.data[pixel] = Math.max(0, Math.min(255, 128 + nx))
      normalImage.data[pixel + 1] = Math.max(0, Math.min(255, 128 + ny))
      normalImage.data[pixel + 2] = normalZ
      normalImage.data[pixel + 3] = 255
      // glTF/Three ORM channels: red AO, green roughness, blue metalness.
      ormImage.data[pixel] = 255
      ormImage.data[pixel + 1] = Math.max(0, Math.min(255, roughness))
      ormImage.data[pixel + 2] = metalness
      ormImage.data[pixel + 3] = 255
    }
  }

  detailContext.putImageData(detailImage, 0, 0)
  normalContext.putImageData(normalImage, 0, 0)
  ormContext.putImageData(ormImage, 0, 0)

  const makeTexture = (canvas: HTMLCanvasElement, name: string, color = false) => {
    const texture = new THREE.CanvasTexture(canvas)
    texture.name = name
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.anisotropy = 8
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
    texture.needsUpdate = true
    return texture
  }
  const textures = {
    detail: makeTexture(detailCanvas, `Forgecast ${kind} 2K color detail`, true),
    normal: makeTexture(normalCanvas, `Forgecast ${kind} 2K normal`),
    orm: makeTexture(ormCanvas, `Forgecast ${kind} 2K ORM`),
  }
  surfaceTextureCache.set(kind, textures)
  return textures
}

function addProjectedUVs(geometry: THREE.BufferGeometry) {
  const projected = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  projected.computeBoundingBox()
  const bounds = projected.boundingBox!
  const size = bounds.getSize(new THREE.Vector3())
  const positions = projected.getAttribute('position')
  const uvs = new Float32Array(positions.count * 2)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const edge1 = new THREE.Vector3()
  const edge2 = new THREE.Vector3()
  const safe = (value: number) => Math.max(value, 0.0001)

  for (let offset = 0; offset < positions.count; offset += 3) {
    a.fromBufferAttribute(positions, offset)
    b.fromBufferAttribute(positions, offset + 1)
    c.fromBufferAttribute(positions, offset + 2)
    edge1.subVectors(b, a)
    edge2.subVectors(c, a)
    normal.crossVectors(edge1, edge2).normalize()
    const axis = Math.abs(normal.x) > Math.abs(normal.y) && Math.abs(normal.x) > Math.abs(normal.z)
      ? 'x'
      : Math.abs(normal.y) > Math.abs(normal.z) ? 'y' : 'z'
    ;[a, b, c].forEach((point, vertex) => {
      const target = (offset + vertex) * 2
      if (axis === 'x') {
        uvs[target] = (point.z - bounds.min.z) / safe(size.z) * 5
        uvs[target + 1] = (point.y - bounds.min.y) / safe(size.y) * 5
      } else if (axis === 'y') {
        uvs[target] = (point.x - bounds.min.x) / safe(size.x) * 5
        uvs[target + 1] = (point.z - bounds.min.z) / safe(size.z) * 5
      } else {
        uvs[target] = (point.x - bounds.min.x) / safe(size.x) * 5
        uvs[target + 1] = (point.y - bounds.min.y) / safe(size.y) * 5
      }
    })
  }
  projected.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  return projected
}

function buildSurfaceMaterials() {
  const common = { vertexColors: true, color: new THREE.Color('#ffffff') }
  const metal = makeSurfaceTextures('metal')
  const leather = makeSurfaceTextures('leather')
  const crystal = makeSurfaceTextures('crystal')
  return [
    new THREE.MeshStandardMaterial({ ...common, name: 'Forgecast metal', map: metal.detail, normalMap: metal.normal, normalScale: new THREE.Vector2(0.34, 0.34), roughnessMap: metal.orm, metalnessMap: metal.orm, roughness: 1, metalness: 1, envMapIntensity: 0.62 }),
    new THREE.MeshStandardMaterial({ ...common, name: 'Forgecast leather', map: leather.detail, normalMap: leather.normal, normalScale: new THREE.Vector2(0.4, 0.4), roughnessMap: leather.orm, metalnessMap: leather.orm, roughness: 1, metalness: 1, envMapIntensity: 0.24 }),
    new THREE.MeshStandardMaterial({
      ...common,
      name: 'Forgecast frost crystal',
      map: crystal.detail,
      normalMap: crystal.normal,
      normalScale: new THREE.Vector2(0.28, 0.28),
      roughnessMap: crystal.orm,
      metalnessMap: crystal.orm,
      roughness: 1,
      metalness: 1,
      envMapIntensity: 0.72,
      emissive: new THREE.Color('#063f49'),
      emissiveIntensity: 0.32,
    }),
  ]
}

function applyColorAwareMaterials(mesh: THREE.Mesh) {
  let geometry = mesh.geometry.clone()
  mesh.geometry = geometry
  const colors = geometry.getAttribute('color')
  const index = geometry.getIndex()
  const materials = buildSurfaceMaterials()

  if (!colors || !index) {
    mesh.material = materials[0]
    materials.slice(1).forEach((material) => material.dispose())
    return
  }

  const triangles: number[][] = [[], [], []]
  for (let offset = 0; offset < index.count; offset += 3) {
    const a = index.getX(offset)
    const b = index.getX(offset + 1)
    const c = index.getX(offset + 2)
    const red = (colors.getX(a) + colors.getX(b) + colors.getX(c)) / 3
    const green = (colors.getY(a) + colors.getY(b) + colors.getY(c)) / 3
    const blue = (colors.getZ(a) + colors.getZ(b) + colors.getZ(c)) / 3
    const leather = red > green * 1.12 && red > blue * 1.45 && red > 0.16
    const crystal = blue > 0.52 && green > 0.42 && blue > red * 1.35 && green > red * 1.15
    const bucket = leather ? 1 : crystal ? 2 : 0
    triangles[bucket].push(a, b, c)
  }

  const IndexArray = geometry.attributes.position.count > 65_535 ? Uint32Array : Uint16Array
  const sortedIndex = new IndexArray(index.count)
  geometry.clearGroups()
  let writeOffset = 0
  triangles.forEach((triangleIndexes, materialIndex) => {
    sortedIndex.set(triangleIndexes, writeOffset)
    if (triangleIndexes.length > 0) geometry.addGroup(writeOffset, triangleIndexes.length, materialIndex)
    writeOffset += triangleIndexes.length
  })
  geometry.setIndex(new THREE.BufferAttribute(sortedIndex, 1))
  geometry = addProjectedUVs(geometry)
  mesh.geometry = geometry
  mesh.material = materials
}

function clearWireframeOverlay(root: THREE.Object3D) {
  const meshes: THREE.Mesh[] = []
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object)
  })
  meshes.forEach((mesh) => {
    const overlay = mesh.children.find((child) => child.name === WIREFRAME_OVERLAY)
    if (!(overlay instanceof THREE.LineSegments)) return
    mesh.remove(overlay)
    overlay.geometry.dispose()
    const materials = Array.isArray(overlay.material) ? overlay.material : [overlay.material]
    materials.forEach((material) => material.dispose())
  })
}

function showWireframeOverlay(root: THREE.Object3D) {
  clearWireframeOverlay(root)
  const meshes: THREE.Mesh[] = []
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object)
  })
  meshes.forEach((mesh) => {
    const overlay = new THREE.LineSegments(
      new THREE.WireframeGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({ color: '#5ff5db', transparent: true, opacity: 0.95, depthTest: false }),
    )
    overlay.name = WIREFRAME_OVERLAY
    overlay.renderOrder = 10
    mesh.add(overlay)
  })
}

function Prop({ palette }: { palette: [string, string, string] }) {
  return (
    <group>
      <mesh position={[0, 0.72, 0]} castShadow>
        <cylinderGeometry args={[0.72, 0.9, 1.25, 8, 1]} />
        <Material color={palette[0]} />
      </mesh>
      <mesh position={[0, 1.55, 0]} castShadow>
        <torusGeometry args={[0.5, 0.14, 8, 12]} />
        <Material color={palette[1]} roughness={0.45} />
      </mesh>
      {[0, 1, 2, 3].map((value) => (
        <mesh key={value} position={[Math.cos(value * Math.PI / 2) * 0.73, 0.7, Math.sin(value * Math.PI / 2) * 0.73]} rotation={[0, -value * Math.PI / 2, 0]} castShadow>
          <boxGeometry args={[0.24, 0.9, 0.22]} />
          <Material color={palette[2]} />
        </mesh>
      ))}
    </group>
  )
}

function Character({ palette }: { palette: [string, string, string] }) {
  return (
    <group>
      <mesh position={[0, 2.45, 0]} castShadow><icosahedronGeometry args={[0.45, 2]} /><Material color={palette[1]} /></mesh>
      <mesh position={[0, 1.45, 0]} castShadow><capsuleGeometry args={[0.52, 1.2, 6, 12]} /><Material color={palette[0]} /></mesh>
      <mesh position={[-0.72, 1.45, 0]} rotation={[0, 0, -0.3]} castShadow><capsuleGeometry args={[0.16, 1.1, 4, 8]} /><Material color={palette[0]} /></mesh>
      <mesh position={[0.72, 1.45, 0]} rotation={[0, 0, 0.3]} castShadow><capsuleGeometry args={[0.16, 1.1, 4, 8]} /><Material color={palette[0]} /></mesh>
      <mesh position={[-0.3, 0.22, 0]} castShadow><capsuleGeometry args={[0.2, 1.25, 4, 8]} /><Material color={palette[2]} /></mesh>
      <mesh position={[0.3, 0.22, 0]} castShadow><capsuleGeometry args={[0.2, 1.25, 4, 8]} /><Material color={palette[2]} /></mesh>
      <mesh position={[0, 1.8, -0.18]} rotation={[Math.PI / 2, 0, 0]} castShadow><coneGeometry args={[0.88, 1.7, 10]} /><Material color={palette[2]} /></mesh>
    </group>
  )
}

function Creature({ palette }: { palette: [string, string, string] }) {
  return (
    <group>
      <mesh position={[0, 1.15, 0]} scale={[1.05, 0.8, 1.35]} castShadow><icosahedronGeometry args={[0.9, 2]} /><Material color={palette[0]} /></mesh>
      <mesh position={[0, 1.3, 1.15]} scale={[0.72, 0.6, 0.7]} castShadow><icosahedronGeometry args={[0.68, 2]} /><Material color={palette[1]} /></mesh>
      {[-0.58, 0.58].map((x) => <mesh key={`front-${x}`} position={[x, 0.35, 0.72]} castShadow><capsuleGeometry args={[0.17, 0.75, 4, 8]} /><Material color={palette[2]} /></mesh>)}
      {[-0.58, 0.58].map((x) => <mesh key={`back-${x}`} position={[x, 0.35, -0.55]} castShadow><capsuleGeometry args={[0.2, 0.78, 4, 8]} /><Material color={palette[2]} /></mesh>)}
      <mesh position={[-0.37, 1.98, 1.32]} rotation={[0.15, 0, -0.18]} castShadow><coneGeometry args={[0.15, 0.75, 7]} /><Material color={palette[2]} /></mesh>
      <mesh position={[0.37, 1.98, 1.32]} rotation={[0.15, 0, 0.18]} castShadow><coneGeometry args={[0.15, 0.75, 7]} /><Material color={palette[2]} /></mesh>
    </group>
  )
}

const GeneratedAsset = forwardRef<THREE.Group, { type: AssetType; style: ArtStyle; wireframe: boolean }>(({ type, style, wireframe }, ref) => {
  const group = useRef<THREE.Group>(null)
  useImperativeHandle(ref, () => group.current as THREE.Group)
  const palette = PALETTES[style]
  useEffect(() => {
    const current = group.current
    if (!current) return
    const faceted = style === 'polygon-game' || style === 'low-poly'
    current.traverse((object) => {
      if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial) {
        object.material.wireframe = false
        object.material.transparent = wireframe
        object.material.opacity = wireframe ? 0.16 : 1
        object.material.depthWrite = !wireframe
        object.material.flatShading = faceted
        object.material.roughness = style === 'polygon-game' ? 0.88 : object.material.roughness
        object.material.metalness = style === 'polygon-game' ? 0.02 : object.material.metalness
        object.material.needsUpdate = true
      }
    })
    if (wireframe) showWireframeOverlay(current)
    else clearWireframeOverlay(current)
    return () => clearWireframeOverlay(current)
  }, [type, style, wireframe])
  return (
    <group ref={group} position={[0, -1.1, 0]} rotation={[0, 0.35, 0]}>
      {type === 'prop' && <Prop palette={palette} />}
      {type === 'character' && <Character palette={palette} />}
      {type === 'creature' && <Creature palette={palette} />}
    </group>
  )
})

const LoadedAsset = forwardRef<THREE.Group, { url: string; style: ArtStyle; wireframe: boolean }>(({ url, style, wireframe }, ref) => {
  const { scene } = useGLTF(url)
  const clone = useMemo(() => {
    const result = scene.clone(true)
    result.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      if (object.geometry.hasAttribute('color')) applyColorAwareMaterials(object)
      else {
        object.geometry = object.geometry.clone()
        object.material = Array.isArray(object.material)
          ? object.material.map((material) => material.clone())
          : object.material.clone()
      }
    })
    return result
  }, [scene])
  const group = useRef<THREE.Group>(null)
  useImperativeHandle(ref, () => group.current as THREE.Group)

  useLayoutEffect(() => {
    if (!group.current) return
    const bounds = new THREE.Box3().setFromObject(clone)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    const scale = 2.8 / Math.max(size.x, size.y, size.z, 0.001)
    clone.position.set(-center.x, -bounds.min.y, -center.z)
    group.current.scale.setScalar(scale)
    group.current.position.set(0, -1.1, 0)
  }, [clone])

  useEffect(() => {
    clone.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material) => {
        if (material instanceof THREE.MeshStandardMaterial) {
          material.wireframe = false
          material.vertexColors = object.geometry.hasAttribute('color')
          material.transparent = wireframe
          material.opacity = wireframe ? 0.16 : 1
          material.depthWrite = !wireframe
          // AI meshes contain many irregular source triangles. Showing every
          // one as a hard face makes curved handles look crumpled. Keep the
          // explicit Low-poly preset faceted, while Polygon-game uses the
          // exported vertex normals for cleaner curves and readable details.
          material.flatShading = style === 'low-poly'
          material.color.set('#ffffff')
          material.needsUpdate = true
        }
      })
    })
    if (wireframe) showWireframeOverlay(clone)
    else clearWireframeOverlay(clone)
    return () => clearWireframeOverlay(clone)
  }, [clone, style, wireframe])

  return <group ref={group}><primitive object={clone} /></group>
})

export const AssetViewer = forwardRef<AssetViewerHandle, { type: AssetType; style: ArtStyle; wireframe?: boolean; autoRotate?: boolean; modelUrl?: string }>(({ type, style, wireframe = false, autoRotate = false, modelUrl }, ref) => {
  const asset = useRef<THREE.Group>(null)
  useImperativeHandle(ref, () => ({ getObject: () => asset.current }))
  return (
    <Canvas
      shadows
      camera={{ position: [4.5, 3.2, 5.8], fov: 38 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
      onCreated={({ gl }) => { gl.toneMappingExposure = 0.82 }}
    >
      <color attach="background" args={['#111517']} />
      <fog attach="fog" args={['#111517', 8, 15]} />
      <ambientLight intensity={0.28} />
      <hemisphereLight intensity={0.42} color="#dbe9e5" groundColor="#151b1c" />
      <directionalLight position={[4, 7, 4]} intensity={1.8} color="#ffe6cf" castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-4, 2, -3]} intensity={0.7} color="#82c7c2" />
      <Suspense fallback={null}>
        {modelUrl ? <LoadedAsset ref={asset} url={modelUrl} style={style} wireframe={wireframe} /> : <GeneratedAsset ref={asset} type={type} style={style} wireframe={wireframe} />}
      </Suspense>
      <Grid position={[0, -1.12, 0]} args={[20, 20]} cellSize={0.5} cellThickness={0.6} cellColor="#2b3839" sectionSize={2} sectionThickness={0.8} sectionColor="#475757" fadeDistance={12} fadeStrength={1.5} infiniteGrid />
      <Environment preset="studio" environmentIntensity={0.48} />
      <OrbitControls makeDefault autoRotate={autoRotate} autoRotateSpeed={1.25} minDistance={3.2} maxDistance={10} target={[0, 0.45, 0]} />
    </Canvas>
  )
})
