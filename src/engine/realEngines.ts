import { QUALITY_LABELS } from '../lib/presets'
import type { CastSettings, MaterialMode, MeshQuality, RealEngineId, ReferenceImageSet } from '../types'
import type { EngineProgress, EngineResult } from './contracts'
import { detectRealEngine as detectHunyuanMini, generateRealMesh } from './modlyEngine'
import { buildStyleConditioning } from './styleRecipes'

const MANAGER_BASE = 'http://127.0.0.1:8764'
const HUNYUAN21_BASE = 'http://127.0.0.1:8081'
const TRELLIS2_BASE = 'http://127.0.0.1:8766'

export interface RealEngineDefinition {
  id: RealEngineId
  name: string
  shortName: string
  description: string
  output: string
  supportsMultiView: boolean
}

export const REAL_ENGINE_DEFINITIONS: Record<RealEngineId, RealEngineDefinition> = {
  'hunyuan-mini': {
    id: 'hunyuan-mini',
    name: 'Hunyuan3D 2 Mini',
    shortName: 'Hunyuan Mini',
    description: 'Fast local shape generation with Forgecast single-view and turntable fusion.',
    output: 'Color GLB',
    supportsMultiView: true,
  },
  'hunyuan-2.1': {
    id: 'hunyuan-2.1',
    name: 'Hunyuan3D 2.1',
    shortName: 'Hunyuan 2.1',
    description: 'Official high-fidelity Shape + PBR Paint pipeline. Uses one front reference.',
    output: 'Shape or PBR GLB',
    supportsMultiView: false,
  },
  'trellis-2': {
    id: 'trellis-2',
    name: 'TRELLIS.2 4B',
    shortName: 'TRELLIS.2',
    description: 'Linux/WSL high-fidelity generation with native PBR materials.',
    output: 'PBR GLB',
    supportsMultiView: false,
  },
}

export interface HardwareProfile {
  gpuName?: string
  vramMb?: number
  profile: 'laptop' | 'desktop'
}

export interface UnifiedEngineStatus extends RealEngineDefinition {
  installed: boolean
  online: boolean
  ready: boolean
  active: boolean
  modelDownloaded: boolean
  label: string
  detail: string
  multiViewDownloaded?: boolean
  paintAvailable?: boolean
  hardware?: HardwareProfile
}

export type UnifiedEngineStatuses = Record<RealEngineId, UnifiedEngineStatus>

interface ManagerState {
  activeEngine?: RealEngineId
  engines?: Partial<Record<RealEngineId, { installed?: boolean }>>
  hardware?: HardwareProfile
}

interface StandardJob {
  status: 'pending' | 'running' | 'done' | 'error' | 'cancelled'
  progress?: number
  stage?: EngineProgress['stage']
  step?: string
  output_url?: string
  error?: string
}

export interface EngineRequestProfile {
  resolution: number
  inferenceSteps: number
  targetTriangles: number
  textureSize: number
  paintProfile?: 'fast' | 'balanced' | 'full'
}

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds))

const fetchJson = async <T>(url: string, timeout = 1500): Promise<T> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout) })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json() as Promise<T>
}

const baseStatus = (id: RealEngineId): UnifiedEngineStatus => ({
  ...REAL_ENGINE_DEFINITIONS[id],
  installed: false,
  online: false,
  ready: false,
  active: false,
  modelDownloaded: false,
  label: 'Not installed',
  detail: REAL_ENGINE_DEFINITIONS[id].description,
})

const managerState = async (): Promise<ManagerState> => {
  try {
    return await fetchJson<ManagerState>(`${MANAGER_BASE}/engines`, 1000)
  } catch {
    return {}
  }
}

const detectHunyuan21 = async (): Promise<{ online: boolean; modelLoaded: boolean; paintAvailable: boolean; message?: string }> => {
  try {
    const health = await fetchJson<{ status?: string; model_loaded?: boolean; paint_available?: boolean; message?: string }>(`${HUNYUAN21_BASE}/health`)
    return { online: health.status === 'healthy', modelLoaded: Boolean(health.model_loaded), paintAvailable: Boolean(health.paint_available), message: health.message }
  } catch {
    return { online: false, modelLoaded: false, paintAvailable: false }
  }
}

const detectTrellis2 = async (): Promise<{ online: boolean; modelLoaded: boolean; message?: string }> => {
  try {
    const health = await fetchJson<{ status?: string; model_loaded?: boolean; message?: string }>(`${TRELLIS2_BASE}/health`)
    return { online: health.status === 'healthy', modelLoaded: Boolean(health.model_loaded), message: health.message }
  } catch {
    return { online: false, modelLoaded: false }
  }
}

export async function detectRealEngines(): Promise<UnifiedEngineStatuses> {
  const [manager, mini, hunyuan21, trellis2] = await Promise.all([
    managerState(),
    detectHunyuanMini(),
    detectHunyuan21(),
    detectTrellis2(),
  ])
  const active = manager.activeEngine
  const hardware = manager.hardware
  const installed = (id: RealEngineId, online: boolean) => Boolean(manager.engines?.[id]?.installed || online)
  const inactiveLabel = (id: RealEngineId) => active && active !== id ? 'Installed · inactive' : 'Installed · starting'

  return {
    'hunyuan-mini': {
      ...baseStatus('hunyuan-mini'),
      installed: installed('hunyuan-mini', mini.apiOnline),
      online: mini.apiOnline,
      ready: mini.modelAvailable,
      active: active === 'hunyuan-mini' || (!active && mini.apiOnline),
      modelDownloaded: mini.modelDownloaded,
      multiViewDownloaded: mini.multiViewDownloaded,
      label: mini.apiOnline ? mini.label : installed('hunyuan-mini', false) ? inactiveLabel('hunyuan-mini') : 'Not installed',
      detail: mini.apiOnline ? 'Fast shape engine; supports exact-turntable multi-view fusion.' : REAL_ENGINE_DEFINITIONS['hunyuan-mini'].description,
      hardware,
    },
    'hunyuan-2.1': {
      ...baseStatus('hunyuan-2.1'),
      installed: installed('hunyuan-2.1', hunyuan21.online),
      online: hunyuan21.online,
      ready: hunyuan21.online,
      active: active === 'hunyuan-2.1' || (!active && hunyuan21.online),
      modelDownloaded: hunyuan21.modelLoaded,
      paintAvailable: hunyuan21.paintAvailable,
      label: hunyuan21.online ? (hunyuan21.modelLoaded ? 'Hunyuan3D 2.1 ready' : 'Ready · model loads on first cast') : installed('hunyuan-2.1', false) ? inactiveLabel('hunyuan-2.1') : 'Not installed',
      detail: hunyuan21.message || REAL_ENGINE_DEFINITIONS['hunyuan-2.1'].description,
      hardware,
    },
    'trellis-2': {
      ...baseStatus('trellis-2'),
      installed: installed('trellis-2', trellis2.online),
      online: trellis2.online,
      ready: trellis2.online,
      active: active === 'trellis-2' || (!active && trellis2.online),
      modelDownloaded: trellis2.modelLoaded,
      label: trellis2.online ? (trellis2.modelLoaded ? 'TRELLIS.2 ready' : 'Ready · 4B model loads on first cast') : installed('trellis-2', false) ? inactiveLabel('trellis-2') : 'Not installed',
      detail: trellis2.message || REAL_ENGINE_DEFINITIONS['trellis-2'].description,
      hardware,
    },
  }
}

export async function activateRealEngine(engineId: RealEngineId): Promise<boolean> {
  try {
    const response = await fetch(`${MANAGER_BASE}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engineId }),
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}

export async function releaseRealEngineGpu(engineId: RealEngineId): Promise<boolean> {
  try {
    const url = engineId === 'hunyuan-mini' ? 'http://127.0.0.1:8765/model/unload-all' : `${MANAGER_BASE}/deactivate`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: engineId === 'hunyuan-mini' ? undefined : JSON.stringify({ engineId }),
      signal: AbortSignal.timeout(10000),
    })
    return response.ok
  } catch {
    return false
  }
}

export function engineRequestProfile(
  engineId: Exclude<RealEngineId, 'hunyuan-mini'>,
  quality: MeshQuality,
  materialMode: MaterialMode = 'pbr',
): EngineRequestProfile {
  const targetTriangles = QUALITY_LABELS[quality].triangles
  if (engineId === 'hunyuan-2.1') {
    const paintProfile = quality === 'preview' ? 'fast' : quality === 'balanced' ? 'balanced' : 'full'
    return {
      resolution: quality === 'preview' ? 256 : quality === 'balanced' ? 384 : 512,
      inferenceSteps: quality === 'preview' ? 20 : quality === 'balanced' ? 35 : 50,
      targetTriangles,
      textureSize: materialMode === 'pbr' ? (quality === 'high' ? 2048 : 1024) : 0,
      paintProfile,
    }
  }
  return {
    resolution: quality === 'preview' ? 512 : 1024,
    inferenceSteps: quality === 'preview' ? 12 : quality === 'balanced' ? 20 : 30,
    targetTriangles,
    textureSize: quality === 'preview' ? 1024 : 2048,
  }
}

const stageFromProgress = (progress: number): EngineProgress['stage'] => {
  if (progress < 12) return 'concept'
  if (progress < 82) return 'shape'
  if (progress < 96) return 'texture'
  return 'finalize'
}

const friendlyHttpError = (error: string) => {
  if (/cuda out of memory|outofmemoryerror/i.test(error)) return 'The GPU ran out of memory. Close other GPU-heavy apps or choose a lower quality.'
  if (/model.*download|huggingface|connection/i.test(error)) return 'The engine could not finish downloading its model files. Check the engine log and retry.'
  const lines = error.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const summary = lines.at(-1) || 'Local generation failed'
  return summary.length > 260 ? `${summary.slice(0, 257)}…` : summary
}

async function generateStandardEngine(
  engineId: 'hunyuan-2.1' | 'trellis-2',
  images: ReferenceImageSet,
  settings: CastSettings,
  onProgress: (progress: EngineProgress) => void,
): Promise<EngineResult> {
  const image = images.front
  if (!image) throw new Error(`${REAL_ENGINE_DEFINITIONS[engineId].name} requires a front reference image.`)
  const base = engineId === 'hunyuan-2.1' ? HUNYUAN21_BASE : TRELLIS2_BASE
  const profile = engineRequestProfile(engineId, settings.quality, settings.materialMode)
  const form = new FormData()
  form.append('image', image)
  form.append('seed', String(settings.seed))
  form.append('resolution', String(profile.resolution))
  form.append('inference_steps', String(profile.inferenceSteps))
  form.append('target_triangles', String(profile.targetTriangles))
  form.append('texture_size', String(profile.textureSize))
  if (engineId === 'hunyuan-2.1' && profile.paintProfile) form.append('paint_profile', profile.paintProfile)

  const submitted = await fetch(`${base}/generate`, { method: 'POST', body: form })
  if (!submitted.ok) throw new Error(friendlyHttpError(await submitted.text()))
  const { job_id: jobId } = await submitted.json() as { job_id: string }

  while (true) {
    await wait(1000)
    const response = await fetch(`${base}/status/${jobId}`)
    if (!response.ok) throw new Error(friendlyHttpError(await response.text()))
    const job = await response.json() as StandardJob
    const percent = Math.max(1, job.progress ?? 1)
    onProgress({ percent, stage: job.stage || stageFromProgress(percent), message: job.step || 'Generating local mesh…' })
    if (job.status === 'error') throw new Error(friendlyHttpError(job.error || 'Local generation failed'))
    if (job.status === 'cancelled') throw new Error('Local generation was cancelled')
    if (job.status === 'done' && job.output_url) {
      return {
        engine: REAL_ENGINE_DEFINITIONS[engineId].name,
        triangles: profile.targetTriangles,
        conditioning: buildStyleConditioning(settings.prompt, settings.assetType, settings.style),
        modelUrl: `${base}${job.output_url}`,
      }
    }
  }
}

export async function generateWithRealEngine(
  engineId: RealEngineId,
  images: ReferenceImageSet,
  settings: CastSettings,
  onProgress: (progress: EngineProgress) => void,
): Promise<EngineResult> {
  if (engineId === 'hunyuan-mini') return generateRealMesh(images, settings, onProgress)
  return generateStandardEngine(engineId, images, settings, onProgress)
}
