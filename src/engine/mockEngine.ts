import { QUALITY_LABELS } from '../lib/presets'
import type { GenerationStage } from '../types'
import type { GenerationEngine } from './contracts'
import { buildStyleConditioning } from './styleRecipes'

const wait = (milliseconds: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds)
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer)
      reject(new DOMException('Generation cancelled', 'AbortError'))
    }, { once: true })
  })

const stageForProgress = (percent: number): Exclude<GenerationStage, 'idle' | 'complete'> => {
  if (percent < 24) return 'concept'
  if (percent < 52) return 'shape'
  if (percent < 78) return 'texture'
  return 'finalize'
}

export const mockEngine: GenerationEngine = {
  id: 'mock',
  name: 'Mock geometry adapter',
  async generate(settings, onProgress, options) {
    const delay = options?.stepDelayMs ?? 48
    for (let percent = 1; percent <= 100; percent += 1) {
      if (options?.signal?.aborted) throw new DOMException('Generation cancelled', 'AbortError')
      const stage = stageForProgress(percent)
      onProgress({ percent, stage, message: `${stage} engine running` })
      await wait(delay, options?.signal)
    }
    return {
      engine: this.name,
      triangles: settings.materialMode === 'pbr' && settings.targetTriangles ? settings.targetTriangles : QUALITY_LABELS[settings.quality].triangles,
      conditioning: buildStyleConditioning(settings.prompt, settings.assetType, settings.style),
    }
  },
}
