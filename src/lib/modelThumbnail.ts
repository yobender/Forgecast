import * as THREE from 'three'

export function thumbnailCamera(bounds: THREE.Box3, aspect = 4 / 3) {
  const sphere = bounds.getBoundingSphere(new THREE.Sphere())
  const radius = Math.max(sphere.radius, 0.001)
  const camera = new THREE.PerspectiveCamera(32, aspect, 0.01, 100)
  const verticalHalfAngle = THREE.MathUtils.degToRad(camera.fov / 2)
  const halfAngle = Math.min(verticalHalfAngle, Math.atan(Math.tan(verticalHalfAngle) * aspect))
  const distance = radius * 1.1 / Math.sin(halfAngle)
  camera.position.copy(sphere.center).addScaledVector(new THREE.Vector3(0.38, 0.18, 1).normalize(), distance)
  camera.near = Math.max((distance - radius) / 2, 0.0001)
  camera.far = distance + radius * 3
  camera.lookAt(sphere.center)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  return camera
}

// Render a framed preview without changing the user's camera, canvas size or mesh.
// Geometry/textures are shared for this one draw; only temporary materials are disposed.
export function captureModelThumbnail(renderer: THREE.WebGLRenderer, object: THREE.Object3D, environment: THREE.Texture | null) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#111517')
  scene.environment = environment
  scene.environmentIntensity = 0.48
  const model = object.clone(true)
  const materials: THREE.Material[] = []
  model.traverse((node) => {
    if (node.name === '__forgecast_wireframe__') node.visible = false
    if (!(node instanceof THREE.Mesh)) return
    const makeOpaque = (source: THREE.Material) => {
      const material = source.clone()
      material.transparent = false
      material.opacity = 1
      material.depthWrite = true
      materials.push(material)
      return material
    }
    node.material = Array.isArray(node.material) ? node.material.map(makeOpaque) : makeOpaque(node.material)
  })
  scene.add(model, new THREE.AmbientLight('#ffffff', 0.4), new THREE.HemisphereLight('#dbe9e5', '#151b1c', 0.6))
  const bounds = new THREE.Box3().setFromObject(model)
  if (bounds.isEmpty()) { materials.forEach((material) => material.dispose()); return null }
  const camera = thumbnailCamera(bounds)
  const key = new THREE.DirectionalLight('#ffe6cf', 1.8)
  const center = bounds.getCenter(new THREE.Vector3())
  key.position.copy(center).add(new THREE.Vector3(4, 7, 4))
  key.target.position.copy(center)
  scene.add(key, key.target)
  const width = 240
  const height = 180
  const target = new THREE.WebGLRenderTarget(width, height, { colorSpace: THREE.SRGBColorSpace })
  const previousTarget = renderer.getRenderTarget()
  try {
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    const pixels = new Uint8Array(width * height * 4)
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return null
    const data = context.createImageData(width, height)
    for (let y = 0; y < height; y += 1) {
      const sourceOffset = (height - 1 - y) * width * 4
      data.data.set(pixels.subarray(sourceOffset, sourceOffset + width * 4), y * width * 4)
    }
    context.putImageData(data, 0, 0)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    renderer.setRenderTarget(previousTarget)
    target.dispose()
    materials.forEach((material) => material.dispose())
  }
}
