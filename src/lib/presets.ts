import type { ArtStyle, GenerationStage, MeshQuality } from '../types'

export const STYLE_LABELS: Record<ArtStyle, string> = {
  'miniature-sculpt': 'Miniature sculpt',
  'hard-surface': 'Hard surface',
  organic: 'Organic',
  'low-poly': 'Low poly',
  'print-safe': 'Print-safe',
}

export const STYLE_DESCRIPTIONS: Record<ArtStyle, string> = {
  'miniature-sculpt': 'Maximum relief and small sculpted forms',
  'hard-surface': 'Sharper plates, bevels and mechanical edges',
  organic: 'Smoother skin, cloth and creature transitions',
  'low-poly': 'Actual mesh reduction with flat preview shading',
  'print-safe': 'Stronger silhouettes and watertight STL remesh',
}

export const normalizeGeometryPreset = (value: unknown): ArtStyle => {
  if (value === 'miniature-sculpt' || value === 'hard-surface' || value === 'organic' || value === 'low-poly' || value === 'print-safe') return value
  if (value === 'polygon-game') return 'hard-surface'
  if (value === 'hand-painted' || value === 'toon') return 'organic'
  return 'miniature-sculpt'
}

export const QUALITY_LABELS: Record<MeshQuality, { label: string; triangles: number; texture: string }> = {
  // Even a fast cast needs enough surface area for wheels, openings, and other
  // prop details. The previous 5K target fragmented complex assets badly.
  preview: { label: 'Draft', triangles: 20000, texture: '1K' },
  balanced: { label: 'Standard', triangles: 50000, texture: '1K' },
  high: { label: 'Detailed', triangles: 100000, texture: '2K' },
  ultra: { label: 'Final · slow', triangles: 150000, texture: '2K' },
}

export interface MiniQualityProfile {
  triangles: number
  inferenceSteps: number
  octreeResolution: number
}

const MINI_QUALITY_PROFILES: Record<'laptop' | 'desktop', Record<MeshQuality, MiniQualityProfile>> = {
  laptop: {
    preview: { triangles: 20000, inferenceSteps: 10, octreeResolution: 256 },
    balanced: { triangles: 35000, inferenceSteps: 20, octreeResolution: 320 },
    high: { triangles: 60000, inferenceSteps: 30, octreeResolution: 384 },
    // An 8 GB laptop GPU is far more dependable at a 384 grid. More steps can
    // refine the reconstruction without the 448-grid VRAM spike that caused
    // long stalls and worker crashes on the laptop.
    ultra: { triangles: 75000, inferenceSteps: 40, octreeResolution: 384 },
  },
  desktop: {
    preview: { triangles: 20000, inferenceSteps: 10, octreeResolution: 256 },
    balanced: { triangles: 50000, inferenceSteps: 30, octreeResolution: 380 },
    high: { triangles: 100000, inferenceSteps: 50, octreeResolution: 512 },
    ultra: { triangles: 150000, inferenceSteps: 70, octreeResolution: 512 },
  },
}

export const miniQualityProfile = (quality: MeshQuality, laptopMode: boolean): MiniQualityProfile =>
  MINI_QUALITY_PROFILES[laptopMode ? 'laptop' : 'desktop'][quality]

export const HUNYUAN_PBR_HINTS: Record<MeshQuality, string> = {
  preview: '3 guided views · 1K PBR · fastest way to check shape and color placement.',
  balanced: '4 guided views · 1K PBR · recommended balance for everyday assets.',
  high: '6 guided views · 2K PBR · slowest mode; reserve it for a final approved shape.',
  ultra: 'Maximum shape steps · 2K PBR · very slow; intended for the final approved reference.',
}

export const STAGES: Array<{ key: Exclude<GenerationStage, 'idle'>; label: string }> = [
  { key: 'concept', label: 'Concept' },
  { key: 'shape', label: 'Shape' },
  { key: 'texture', label: 'Texture' },
  { key: 'finalize', label: 'Finalize' },
  { key: 'complete', label: 'Ready' },
]
