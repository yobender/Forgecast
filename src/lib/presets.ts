import type { ArtStyle, GenerationStage, MeshQuality } from '../types'

export const STYLE_LABELS: Record<ArtStyle, string> = {
  'polygon-game': 'Polygon game',
  sculpted: 'Sculpted',
  'hand-painted': 'Hand-painted',
  'low-poly': 'Low poly',
  'dark-fantasy': 'Dark fantasy',
  toon: 'Toon',
}

export const QUALITY_LABELS: Record<MeshQuality, { label: string; triangles: number; texture: string }> = {
  // Even a fast cast needs enough surface area for wheels, openings, and other
  // prop details. The previous 5K target fragmented complex assets badly.
  preview: { label: 'Fast test', triangles: 20000, texture: '1K' },
  balanced: { label: 'Balanced', triangles: 50000, texture: '1K' },
  high: { label: 'Full quality', triangles: 100000, texture: '2K' },
}

export interface MiniQualityProfile {
  triangles: number
  inferenceSteps: number
  octreeResolution: number
}

const MINI_QUALITY_PROFILES: Record<'laptop' | 'desktop', Record<MeshQuality, MiniQualityProfile>> = {
  laptop: {
    preview: { triangles: 20000, inferenceSteps: 10, octreeResolution: 256 },
    balanced: { triangles: 40000, inferenceSteps: 24, octreeResolution: 320 },
    high: { triangles: 75000, inferenceSteps: 35, octreeResolution: 384 },
  },
  desktop: {
    preview: { triangles: 20000, inferenceSteps: 10, octreeResolution: 256 },
    balanced: { triangles: 50000, inferenceSteps: 30, octreeResolution: 380 },
    high: { triangles: 100000, inferenceSteps: 50, octreeResolution: 512 },
  },
}

export const miniQualityProfile = (quality: MeshQuality, laptopMode: boolean): MiniQualityProfile =>
  MINI_QUALITY_PROFILES[laptopMode ? 'laptop' : 'desktop'][quality]

export const HUNYUAN_PBR_HINTS: Record<MeshQuality, string> = {
  preview: '3 guided views · 1K PBR · fastest way to check shape and color placement.',
  balanced: '4 guided views · 1K PBR · recommended balance for everyday assets.',
  high: '6 guided views · 2K PBR · slowest mode; reserve it for a final approved shape.',
}

export const STAGES: Array<{ key: Exclude<GenerationStage, 'idle'>; label: string }> = [
  { key: 'concept', label: 'Concept' },
  { key: 'shape', label: 'Shape' },
  { key: 'texture', label: 'Texture' },
  { key: 'finalize', label: 'Finalize' },
  { key: 'complete', label: 'Ready' },
]
