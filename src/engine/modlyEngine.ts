import type { CastSettings, ReferenceImageSet, ReferenceView } from '../types'
import type { EngineProgress, EngineResult } from './contracts'
import { QUALITY_LABELS } from '../lib/presets'
import { buildStyleConditioning } from './styleRecipes'

const API_BASE = 'http://127.0.0.1:8765'
const SINGLE_MODEL_ID = 'hunyuan3d-mini/generate'
const MULTI_MODEL_ID = 'hunyuan3d-mini/multiview'

export interface RealEngineStatus {
  apiOnline: boolean
  modelAvailable: boolean
  modelDownloaded: boolean
  multiViewAvailable: boolean
  multiViewDownloaded: boolean
  label: string
}

interface ModlyJob {
  status: 'pending' | 'running' | 'done' | 'error' | 'cancelled'
  progress: number
  step?: string
  output_url?: string
  error?: string
}

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds))

const friendlyEngineError = (error: string) => {
  if (/cv2\.error[\s\S]*resize/i.test(error)) return 'Forgecast could not prepare a reference image. The image worker has been refreshed; please try the cast again.'
  if (/cuda out of memory|outofmemoryerror/i.test(error)) return 'The GPU ran out of memory. Close other GPU-heavy apps or choose a lower mesh quality and try again.'
  if (/subprocess died|worker.*(stopped|exited)/i.test(error)) return 'The local AI worker stopped unexpectedly. Please try the cast again.'
  const lines = error.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const summary = lines.at(-1) || 'Local generation failed'
  return summary.length > 260 ? `${summary.slice(0, 257)}…` : summary
}

export async function detectRealEngine(): Promise<RealEngineStatus> {
  try {
    const health = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(1200) })
    if (!health.ok) throw new Error('Backend health check failed')
    const response = await fetch(`${API_BASE}/model/all`, { signal: AbortSignal.timeout(1800) })
    const models = response.ok ? await response.json() as Array<{ id: string; downloaded?: boolean; loadError?: string }> : []
    const model = models.find((entry) => entry.id === SINGLE_MODEL_ID)
    const multiViewModel = models.find((entry) => entry.id === MULTI_MODEL_ID)
    return {
      apiOnline: true,
      modelAvailable: Boolean(model && !model.loadError),
      modelDownloaded: Boolean(model?.downloaded),
      multiViewAvailable: Boolean(multiViewModel && !multiViewModel.loadError),
      multiViewDownloaded: Boolean(multiViewModel?.downloaded),
      label: multiViewModel?.downloaded ? 'Hunyuan3D multi-view ready' : model?.downloaded ? 'Hunyuan3D Mini ready' : model ? 'Hunyuan3D needs model files' : 'Hunyuan3D extension unavailable',
    }
  } catch {
    return { apiOnline: false, modelAvailable: false, modelDownloaded: false, multiViewAvailable: false, multiViewDownloaded: false, label: 'Real AI engine offline' }
  }
}

const stageFromProgress = (progress: number): EngineProgress['stage'] => {
  if (progress < 12) return 'concept'
  if (progress < 85) return 'shape'
  if (progress < 96) return 'texture'
  return 'finalize'
}

export async function generateRealMesh(
  images: ReferenceImageSet,
  settings: CastSettings,
  onProgress: (progress: EngineProgress) => void,
): Promise<EngineResult> {
  const form = new FormData()
  const suppliedViews = (Object.entries(images) as Array<[ReferenceView, File]>).filter((entry) => Boolean(entry[1]))
  if (suppliedViews.length === 0) throw new Error('Add at least one reference image before generating.')
  const useMultiView = suppliedViews.length > 1
  const useFrontPriority = useMultiView && settings.referenceFusion !== 'full' && Boolean(images.front)
  const targetTriangles = QUALITY_LABELS[settings.quality].triangles
  if (useMultiView && !useFrontPriority) suppliedViews.forEach(([view, file]) => form.append(view, file))
  else form.append('image', images.front ?? suppliedViews[0][1])
  form.append('model_id', useMultiView && !useFrontPriority ? MULTI_MODEL_ID : SINGLE_MODEL_ID)
  form.append('collection', 'Forgecast')
  form.append('remesh', 'none')
  form.append('enable_texture', 'false')
  form.append('params', JSON.stringify({
    num_inference_steps: settings.quality === 'preview' ? 10 : settings.quality === 'balanced' ? 30 : 50,
    octree_resolution: settings.quality === 'preview' ? 256 : settings.quality === 'balanced' ? 380 : 512,
    guidance_scale: 5.5,
    seed: settings.seed,
    // A closed triangle mesh generally has about two faces per vertex.
    // Respect the selected quality instead of silently forcing every
    // Polygon-game cast down to the 5K-triangle preview budget.
    vertex_count: Math.round(targetTriangles / 2),
    preserve_color: true,
    // Feed the shape network an edge-preserving, texture-softened copy while
    // retaining the untouched references for the color bake. This prevents
    // hammered metal and leather grain from becoming melted mesh noise.
    clean_shape_guides: settings.quality === 'high',
    shape_source: useFrontPriority ? 'front' : 'all',
  }))

  const endpoint = useMultiView && !useFrontPriority ? 'from-images' : 'from-image'
  const submitted = await fetch(`${API_BASE}/generate/${endpoint}`, { method: 'POST', body: form })
  if (!submitted.ok) throw new Error(await submitted.text())
  const { job_id: jobId } = await submitted.json() as { job_id: string }

  while (true) {
    await wait(1000)
    const response = await fetch(`${API_BASE}/generate/status/${jobId}`)
    if (!response.ok) throw new Error(await response.text())
    const job = await response.json() as ModlyJob
    const percent = Math.max(1, job.progress ?? 0)
    onProgress({ percent, stage: stageFromProgress(percent), message: job.step || 'Generating local mesh…' })
    if (job.status === 'error') throw new Error(friendlyEngineError(job.error || 'Local generation failed'))
    if (job.status === 'cancelled') throw new Error('Local generation was cancelled')
    if (job.status === 'done' && job.output_url) {
      return {
        engine: useFrontPriority
          ? `Hunyuan3D 2 Front Only · ${suppliedViews.length - 1} refs ignored`
          : useMultiView
            ? `Hunyuan3D 2 Multi-View · ${suppliedViews.length} refs`
            : 'Hunyuan3D 2 Mini',
        triangles: targetTriangles,
        conditioning: buildStyleConditioning(settings.prompt, settings.assetType, settings.style),
        modelUrl: `${API_BASE}${job.output_url}`,
      }
    }
  }
}
