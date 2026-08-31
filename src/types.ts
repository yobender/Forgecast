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
export type GenerationWorkflow = 'quick' | 'workshop'
export type WorkflowRole = 'candidate' | 'master'
export type GameProtection = 'strict' | 'balanced' | 'flexible'
export interface GameMeshStats {
  inputTriangles: number
  outputTriangles: number
  inputVertices: number
  outputVertices: number
  inputBytes: number
  outputBytes: number
  targetTriangles: number
  targetMet: boolean
  maxAppearanceError: number
  reductionPercent: number
  correctedColors: boolean
  colorSpace: 'linear'
  sourceFeatures?: {
    normals: boolean
    vertexColors: boolean
    texcoords: boolean
    baseColorTexture: boolean
    normalTexture: boolean
  }
  warnings: string[]
}

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
  preserveMasterMesh?: boolean
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
  workflowId?: string
  workflowRole?: WorkflowRole
  candidateIndex?: number
  sourceRecordId?: string
  meshRole?: 'source' | 'game' | 'color-copy'
  colorSpace?: 'linear'
  gameStats?: GameMeshStats
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
