import { describe, expect, it } from 'vitest'
import { buildStyleConditioning } from './styleRecipes'

describe('polygon game style recipe', () => {
  it('bakes the visual language and mesh constraints into conditioning', () => {
    const recipe = buildStyleConditioning('a blacksmith forge', 'prop', 'polygon-game')
    expect(recipe.positive).toContain('broad faceted planes')
    expect(recipe.positive).toContain('a blacksmith forge')
    expect(recipe.negative).toContain('photorealistic')
    expect(recipe.geometry.shading).toBe('flat')
    expect(recipe.geometry.preferredTriangles).toBe(5000)
  })
})
