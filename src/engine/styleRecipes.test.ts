import { describe, expect, it } from 'vitest'
import { buildStyleConditioning, GEOMETRY_PRESETS } from './styleRecipes'

describe('geometry presets', () => {
  it('makes miniature sculpt preserve the raw print reconstruction', () => {
    const recipe = buildStyleConditioning('an afflicted pilgrim', 'character', 'miniature-sculpt')
    expect(recipe.positive).toContain('high-relief miniature sculpt')
    expect(recipe.positive).toContain('an afflicted pilgrim')
    expect(recipe.generation.preserveRawPrintMesh).toBe(true)
    expect(recipe.geometry.shading).toBe('smooth')
  })

  it('makes low poly a real reduced, flat-shaded mesh profile', () => {
    expect(GEOMETRY_PRESETS['low-poly'].targetTriangleRatio).toBeLessThan(0.5)
    expect(GEOMETRY_PRESETS['low-poly'].preserveRawPrintMesh).toBe(false)
    expect(GEOMETRY_PRESETS['low-poly'].flatShading).toBe(true)
  })

  it('marks print-safe exports for watertight remeshing', () => {
    const recipe = buildStyleConditioning('', 'prop', 'print-safe')
    expect(recipe.generation.guideProfile).toBe('print-safe')
    expect(recipe.generation.forceWatertightRemesh).toBe(true)
  })
})
