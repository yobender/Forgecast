export type AssetType = 'prop' | 'character' | 'creature'
// Kept as ArtStyle internally so older saved cast records remain readable.
// These values now describe real mesh-processing behavior, not visual themes.
export type ArtStyle = 'miniature-sculpt' | 'hard-surface' | 'organic' | 'low-poly' | 'print-safe'
export type MeshQuality = 'preview' | 'balanced' | 'high' | 'ultra'
export type GenerationStage = 'idle' | 'concept' | 'shape' | 'texture' | 'finalize' | 'complete'
export type ReferenceView = 'front' | 'left' | 'back' | 'right' | 'top' | 'bottom'
export type ReferenceFusionMode = 'front-priority' | 'full'
export type MaterialMode = 'shape-only' | 'pbr'
export type ReferenceImageSet = Partial<Record<ReferenceView, File>>
export type RealEngineId = 'hunyuan-mini' | 'hunyuan-2.1' | 'trellis-2'
export type PerformanceMode = 'laptop' | 'desktop'
export type PrintRefineProfile = 'balanced' | 'fine'

export interface CastSettings {
  prompt: string
  assetType: AssetType
  style: ArtStyle
  quality: MeshQuality
  seed: number
  materialMode?: MaterialMode
  referenceFusion?: ReferenceFusionMode
  engineId?: RealEngineId
  performanceMode?: PerformanceMode
  printHeightMm?: number
  printRefineProfile?: PrintRefineProfile
  targetTriangles?: number
}

export interface CastRecord extends CastSettings {
  id: string
  createdAt: string
  engine: string
  triangles: number
  modelUrl?: string
  thumbnail?: string
  displayName?: string
  favorite?: boolean
  modelBytes?: number
}

export interface MeshInspection {
  vertices: number
  triangles: number
  meshes: number
  components: number
  materials: number
  watertight: boolean
  extents: [number, number, number]
  surfaceArea: number
  fileBytes: number
}
