import type { CastSettings, GenerationStage } from '../types'
import type { StyleConditioning } from './styleRecipes'

export interface EngineProgress {
  percent: number
  stage: Exclude<GenerationStage, 'idle' | 'complete'>
  message: string
}

export interface EngineResult {
  engine: string
  triangles: number
  conditioning: StyleConditioning
  modelUrl?: string
}

export interface GenerationEngine {
  readonly id: string
  readonly name: string
  generate: (
    settings: CastSettings,
    onProgress: (progress: EngineProgress) => void,
    options?: { signal?: AbortSignal; stepDelayMs?: number },
  ) => Promise<EngineResult>
}
