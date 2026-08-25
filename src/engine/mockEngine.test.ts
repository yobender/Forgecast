import { describe, expect, it, vi } from 'vitest'
import { mockEngine } from './mockEngine'

describe('mockEngine', () => {
  it('reports the full pipeline and returns the requested triangle budget', async () => {
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    const stages = new Set<string>()
    const result = await mockEngine.generate(
      { prompt: 'test', assetType: 'prop', style: 'sculpted', quality: 'balanced', seed: 1 },
      ({ stage }) => stages.add(stage),
      { stepDelayMs: 0 },
    )
    expect([...stages]).toEqual(['concept', 'shape', 'texture', 'finalize'])
    expect(result.triangles).toBe(20000)
    vi.unstubAllGlobals()
  })
})
