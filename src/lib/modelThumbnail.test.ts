import { describe, expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import { thumbnailCamera } from './modelThumbnail'

describe('thumbnail camera framing', () => {
  it.each([
    [new Vector3(-1, -1.1, -0.5), new Vector3(1, 1.7, 0.5), 4 / 3],
    [new Vector3(-6, 12, -2), new Vector3(6, 13, 2), 4 / 3],
    [new Vector3(10, 0, 2), new Vector3(11, 10, 3), 0.7],
    [new Vector3(0, 0, 0), new Vector3(0, 0, 0), 4 / 3],
  ])('fits every corner, including wide, tall and offset models', (min, max, aspect) => {
    const bounds = new Box3(min, max)
    const camera = thumbnailCamera(bounds, aspect)
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
      const projected = new Vector3(x, y, z).project(camera)
      expect(Math.abs(projected.x)).toBeLessThan(1)
      expect(Math.abs(projected.y)).toBeLessThan(1)
      expect(Math.abs(projected.z)).toBeLessThan(1)
    }
    expect(bounds.min.equals(min)).toBe(true)
    expect(bounds.max.equals(max)).toBe(true)
  })
})
