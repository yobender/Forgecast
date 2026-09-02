import { describe, expect, it } from 'vitest'
import { engineRequestProfile, REAL_ENGINE_DEFINITIONS } from './realEngines'

describe('real engine registry', () => {
  it('keeps multi-view support limited to the patched Mini engine', () => {
    expect(REAL_ENGINE_DEFINITIONS['hunyuan-mini'].supportsMultiView).toBe(true)
    expect(REAL_ENGINE_DEFINITIONS['hunyuan-2.1'].supportsMultiView).toBe(false)
    expect(REAL_ENGINE_DEFINITIONS['trellis-2'].supportsMultiView).toBe(false)
  })

  it('uses hardware-conscious quality profiles for the advanced engines', () => {
    expect(engineRequestProfile('hunyuan-2.1', 'preview')).toMatchObject({ resolution: 256, inferenceSteps: 20, targetTriangles: 20000, textureSize: 1024, paintProfile: 'fast' })
    expect(engineRequestProfile('hunyuan-2.1', 'balanced')).toMatchObject({ resolution: 384, inferenceSteps: 35, targetTriangles: 50000, textureSize: 1024, paintProfile: 'balanced' })
    expect(engineRequestProfile('hunyuan-2.1', 'high')).toMatchObject({ resolution: 448, inferenceSteps: 50, targetTriangles: 100000, textureSize: 2048, paintProfile: 'full' })
    expect(engineRequestProfile('hunyuan-2.1', 'high', 'shape-only')).toMatchObject({ resolution: 448, inferenceSteps: 50, textureSize: 0, paintProfile: 'full' })
    expect(engineRequestProfile('hunyuan-2.1', 'ultra', 'shape-only')).toMatchObject({ resolution: 512, inferenceSteps: 65, targetTriangles: 150000, textureSize: 0, paintProfile: 'full' })
    expect(engineRequestProfile('trellis-2', 'preview')).toMatchObject({ resolution: 512, inferenceSteps: 12, textureSize: 1024 })
    expect(engineRequestProfile('trellis-2', 'high')).toMatchObject({ resolution: 1024, inferenceSteps: 30, textureSize: 2048 })
    expect(engineRequestProfile('trellis-2', 'ultra')).toMatchObject({ resolution: 1024, inferenceSteps: 40, targetTriangles: 150000, textureSize: 2048 })
  })
})
