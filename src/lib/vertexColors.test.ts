import { BufferGeometry, Uint8BufferAttribute } from 'three'
import { expect, it } from 'vitest'
import { linearizeLegacyVertexColors } from './vertexColors'

it('converts normalized sRGB bytes without touching alpha or applying twice', () => {
  const geometry = new BufferGeometry().setAttribute('color', new Uint8BufferAttribute([128,64,32,200],4,true))
  linearizeLegacyVertexColors(geometry)
  const color = geometry.getAttribute('color')
  expect(color.getX(0)).toBeCloseTo(0.21586,5)
  expect(color.getW(0)).toBeCloseTo(200/255)
  linearizeLegacyVertexColors(geometry)
  expect(geometry.getAttribute('color')).toBe(color)
})
