import type { ArtStyle, AssetType } from '../types'

export interface StyleConditioning {
  positive: string
  negative: string
  geometry: {
    silhouette: string
    topology: string
    shading: 'flat' | 'smooth'
    preferredTriangles: number
  }
  palette: string[]
}

const SUBJECT_HINTS: Record<AssetType, string> = {
  prop: 'single freestanding game prop, centered, fully visible',
  character: 'single full-body game character in a neutral A-pose, centered, fully visible',
  creature: 'single full-body game creature in a neutral standing pose, centered, fully visible',
}

const POLYGON_GAME: Omit<StyleConditioning, 'positive'> & { prefix: string } = {
  prefix: 'stylized low-poly 3D game asset, chunky appealing proportions, strong readable silhouette, deliberately simplified forms, broad faceted planes, hand-authored game-art appearance, restrained color blocking, subtle painted gradients, clean isolated presentation',
  negative: 'photorealistic, scanned surface, noisy micro-detail, thin fragile pieces, excessive bevels, high-frequency texture, realistic skin pores, cluttered background, multiple objects, text, logo, watermark, smooth subdivided sculpture',
  geometry: {
    silhouette: 'Readable at thumbnail distance with exaggerated primary and secondary forms.',
    topology: 'Low-density manifold mesh; preserve planar facets and avoid decorative micro-geometry.',
    shading: 'flat',
    preferredTriangles: 5000,
  },
  palette: ['#4f967d', '#e0ad57', '#263c38', '#d9d4bd'],
}

const GENERIC_NEGATIVE = 'cluttered background, multiple objects, text, logo, watermark, broken geometry, floating pieces'

export function buildStyleConditioning(prompt: string, assetType: AssetType, style: ArtStyle): StyleConditioning {
  if (style === 'polygon-game') {
    return {
      positive: `${POLYGON_GAME.prefix}, ${SUBJECT_HINTS[assetType]}. Subject: ${prompt.trim()}`,
      negative: POLYGON_GAME.negative,
      geometry: POLYGON_GAME.geometry,
      palette: POLYGON_GAME.palette,
    }
  }

  return {
    positive: `${style.replace('-', ' ')} 3D asset, ${SUBJECT_HINTS[assetType]}. Subject: ${prompt.trim()}`,
    negative: GENERIC_NEGATIVE,
    geometry: {
      silhouette: 'Clear primary silhouette.',
      topology: 'Manifold mesh suitable for automatic cleanup.',
      shading: style === 'low-poly' ? 'flat' : 'smooth',
      preferredTriangles: style === 'low-poly' ? 5000 : 20000,
    },
    palette: [],
  }
}
