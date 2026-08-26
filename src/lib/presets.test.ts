import { describe, expect, it } from 'vitest'
import { miniQualityProfile } from './presets'
import { miniVertexBudget } from '../engine/modlyEngine'

describe('miniQualityProfile', () => {
  it('caps laptop-safe balanced and high casts below the desktop budgets', () => {
    expect(miniQualityProfile('balanced', true)).toEqual({ triangles: 40000, inferenceSteps: 24, octreeResolution: 320 })
    expect(miniQualityProfile('high', true)).toEqual({ triangles: 75000, inferenceSteps: 35, octreeResolution: 384 })
  })

  it('retains the full desktop quality budgets', () => {
    expect(miniQualityProfile('balanced', false)).toEqual({ triangles: 50000, inferenceSteps: 30, octreeResolution: 380 })
    expect(miniQualityProfile('high', false)).toEqual({ triangles: 100000, inferenceSteps: 50, octreeResolution: 512 })
  })

  it('keeps the raw reconstruction for STL casts but caps color assets', () => {
    expect(miniVertexBudget('shape-only', 75000)).toBe(0)
    expect(miniVertexBudget('pbr', 75000)).toBe(37500)
  })
})
