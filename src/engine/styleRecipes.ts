import type { ArtStyle, AssetType } from '../types'

export type ShapeGuideProfile = 'detail' | 'hard-surface' | 'organic' | 'simplified' | 'print-safe'

export interface GeometryPresetProfile {
  guideProfile: ShapeGuideProfile
  guidanceScale: number
  targetTriangleRatio: number
  preserveRawPrintMesh: boolean
  flatShading: boolean
  forceWatertightRemesh: boolean
}

export interface StyleConditioning {
  positive: string
  negative: string
  geometry: {
    silhouette: string
    topology: string
    shading: 'flat' | 'smooth'
    preferredTriangles: number
  }
  generation: GeometryPresetProfile
  palette: string[]
}

const SUBJECT_HINTS: Record<AssetType, string> = {
  prop: 'single freestanding prop, centered and fully visible',
  character: 'single full-body character in a neutral stance, centered and fully visible',
  creature: 'single full-body creature in a neutral standing pose, centered and fully visible',
}

export const GEOMETRY_PRESETS: Record<ArtStyle, GeometryPresetProfile> = {
  'miniature-sculpt': {
    guideProfile: 'detail',
    guidanceScale: 7.0,
    targetTriangleRatio: 1,
    preserveRawPrintMesh: true,
    flatShading: false,
    forceWatertightRemesh: false,
  },
  'hard-surface': {
    guideProfile: 'hard-surface',
    guidanceScale: 6.5,
    targetTriangleRatio: 0.9,
    preserveRawPrintMesh: true,
    flatShading: false,
    forceWatertightRemesh: false,
  },
  organic: {
    guideProfile: 'organic',
    guidanceScale: 5.5,
    targetTriangleRatio: 0.9,
    preserveRawPrintMesh: true,
    flatShading: false,
    forceWatertightRemesh: false,
  },
  'low-poly': {
    guideProfile: 'simplified',
    guidanceScale: 4.5,
    targetTriangleRatio: 0.2,
    preserveRawPrintMesh: false,
    flatShading: true,
    forceWatertightRemesh: false,
  },
  'print-safe': {
    guideProfile: 'print-safe',
    guidanceScale: 5.8,
    targetTriangleRatio: 0.8,
    preserveRawPrintMesh: true,
    flatShading: false,
    forceWatertightRemesh: true,
  },
}

const PRESET_COPY: Record<ArtStyle, { positive: string; negative: string; silhouette: string; topology: string }> = {
  'miniature-sculpt': {
    positive: 'high-relief miniature sculpt with readable secondary forms and preserved engraved detail',
    negative: 'melted detail, shallow relief, over-smoothed edges, fragile micro-parts',
    silhouette: 'Preserve the reference silhouette and readable miniature-scale relief.',
    topology: 'Retain the raw reconstruction for print output; avoid destructive decimation.',
  },
  'hard-surface': {
    positive: 'edge-defined hard-surface reconstruction with crisp plates, bevels, panels and mechanical breaks',
    negative: 'rounded plate edges, melted panel lines, inflated mechanical forms',
    silhouette: 'Favor straight boundaries, plate separation and crisp mechanical corners.',
    topology: 'Use edge-enhanced shape guides and retain raw print geometry.',
  },
  organic: {
    positive: 'smooth organic reconstruction with coherent skin, cloth and creature transitions',
    negative: 'noisy skin, staircase contours, harsh faceting, disconnected surface grain',
    silhouette: 'Preserve broad anatomical and cloth forms with smooth transitions.',
    topology: 'Suppress surface noise before reconstruction while retaining major folds.',
  },
  'low-poly': {
    positive: 'deliberately simplified low-poly reconstruction with broad planes and an economical silhouette',
    negative: 'dense micro-geometry, unnecessary subdivisions, noisy triangulation',
    silhouette: 'Prioritize primary forms that remain readable after strong reduction.',
    topology: 'Generate from a simplified guide and decimate to a true low-poly budget.',
  },
  'print-safe': {
    positive: 'sturdy printable reconstruction with closed gaps, attached details and strengthened silhouettes',
    negative: 'floating pieces, pinholes, paper-thin gaps, isolated droplets, fragile protrusions',
    silhouette: 'Slightly close and strengthen narrow silhouette gaps before reconstruction.',
    topology: 'Retain raw shape geometry and force a watertight STL remesh at export.',
  },
}

export function buildStyleConditioning(prompt: string, assetType: AssetType, style: ArtStyle): StyleConditioning {
  const preset = GEOMETRY_PRESETS[style]
  const copy = PRESET_COPY[style]
  return {
    positive: `${copy.positive}, ${SUBJECT_HINTS[assetType]}. Subject: ${prompt.trim()}`,
    negative: `${copy.negative}, cluttered background, multiple objects, text, logo, watermark, broken geometry`,
    geometry: {
      silhouette: copy.silhouette,
      topology: copy.topology,
      shading: preset.flatShading ? 'flat' : 'smooth',
      preferredTriangles: Math.round(50000 * preset.targetTriangleRatio),
    },
    generation: preset,
    palette: [],
  }
}
