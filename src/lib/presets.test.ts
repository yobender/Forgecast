import { describe, expect, it } from 'vitest'
import { miniQualityProfile } from './presets'
import { miniVertexBudget } from '../engine/modlyEngine'

describe('miniQualityProfile', () => {
  it('caps laptop-safe balanced and high casts below the desktop budgets', () => {
    expect(miniQualityProfile('balanced', true)).toEqual({ triangles: 35000, inferenceSteps: 20, octreeResolution: 320 })
    expect(miniQualityProfile('high', true)).toEqual({ triangles: 60000, inferenceSteps: 30, octreeResolution: 384 })
  })

  it('retains the full desktop quality budgets', () => {
    expect(miniQualityProfile('balanced', false)).toEqual({ triangles: 50000, inferenceSteps: 30, octreeResolution: 380 })
    expect(miniQualityProfile('high', false)).toEqual({ triangles: 100000, inferenceSteps: 50, octreeResolution: 512 })
  })

  it('keeps the laptop final profile inside the stable 384-grid ceiling', () => {
    const high = miniQualityProfile('high', true)
    const ultra = miniQualityProfile('ultra', true)
    expect(ultra.octreeResolution).toBe(384)
    expect(ultra.inferenceSteps).toBeGreaterThan(high.inferenceSteps)
    expect(ultra.triangles).toBe(75000)
  })

  it('keeps the raw reconstruction for STL casts but caps color assets', () => {
    expect(miniVertexBudget('shape-only', 75000)).toBe(0)
    expect(miniVertexBudget('pbr', 75000)).toBe(37500)
  })
})
