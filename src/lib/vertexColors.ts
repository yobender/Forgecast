import { BufferGeometry, Float32BufferAttribute } from 'three'

export function linearizeLegacyVertexColors(geometry: BufferGeometry) {
  const color = geometry.getAttribute('color')
  if (!color || geometry.userData.forgecastLinearColors) return
  const array = new Float32Array(color.count * color.itemSize)
  const linear = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  for (let i = 0; i < color.count; i++) {
    array[i * color.itemSize] = linear(color.getX(i))
    array[i * color.itemSize + 1] = linear(color.getY(i))
    array[i * color.itemSize + 2] = linear(color.getZ(i))
    if (color.itemSize === 4) array[i * color.itemSize + 3] = color.getW(i)
  }
  geometry.setAttribute('color', new Float32BufferAttribute(array, color.itemSize))
  geometry.userData.forgecastLinearColors = true
}
