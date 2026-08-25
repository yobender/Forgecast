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
  preview: { label: 'Preview', triangles: 5000, texture: 'Vertex color' },
  balanced: { label: 'Balanced', triangles: 20000, texture: 'Vertex color' },
  // High keeps enough of the extracted surface for crisp hard-surface edges.
  // 50K was too aggressive for detailed props and made the preset look only
  // marginally better than Balanced after decimation.
  high: { label: 'High detail', triangles: 150000, texture: 'Vertex color' },
}

export const STAGES: Array<{ key: Exclude<GenerationStage, 'idle'>; label: string }> = [
  { key: 'concept', label: 'Concept' },
  { key: 'shape', label: 'Shape' },
  { key: 'texture', label: 'Texture' },
  { key: 'finalize', label: 'Finalize' },
  { key: 'complete', label: 'Ready' },
]
