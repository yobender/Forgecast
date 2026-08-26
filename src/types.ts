export type AssetType = 'prop' | 'character' | 'creature'
export type ArtStyle = 'polygon-game' | 'sculpted' | 'hand-painted' | 'low-poly' | 'dark-fantasy' | 'toon'
export type MeshQuality = 'preview' | 'balanced' | 'high'
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
}

export interface CastRecord extends CastSettings {
  id: string
  createdAt: string
  engine: string
  triangles: number
}
