import { describe, expect, it, vi } from 'vitest'
import { mockEngine } from './mockEngine'

describe('mockEngine', () => {
  it('reports the full pipeline and returns the requested triangle budget', async () => {
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    const stages = new Set<string>()
    const result = await mockEngine.generate(
      { prompt: 'test', assetType: 'prop', style: 'miniature-sculpt', quality: 'balanced', seed: 1 },
      ({ stage }) => stages.add(stage),
      { stepDelayMs: 0 },
    )
    expect([...stages]).toEqual(['concept', 'shape', 'texture', 'finalize'])
    expect(result.triangles).toBe(50000)
    vi.unstubAllGlobals()
  })

  it('keeps game output budget independent from reconstruction quality', async () => {
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    const result = await mockEngine.generate(
      { prompt: 'game prop', assetType: 'prop', style: 'hard-surface', quality: 'ultra', seed: 2, materialMode: 'pbr', targetTriangles: 25000 },
      () => undefined,
      { stepDelayMs: 0 },
    )
    expect(result.triangles).toBe(25000)
    vi.unstubAllGlobals()
  })
})
