import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Check, ChevronDown, Clock3, Cpu, Download, HardDrive, Heart, ImagePlus, Layers3, Play, RefreshCw, Rotate3D, Search, Settings2, Sparkles, Trash2, WandSparkles } from 'lucide-react'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { STLExporter } from 'three/addons/exporters/STLExporter.js'
import { AssetViewer, type AssetViewerHandle } from './components/AssetViewer'
import { BrandMark } from './components/BrandMark'
import { StageRail } from './components/StageRail'
import { mockEngine } from './engine/mockEngine'
import { activateRealEngine, detectRealEngines, generateWithRealEngine, releaseRealEngineGpu, REAL_ENGINE_DEFINITIONS, type UnifiedEngineStatuses } from './engine/realEngines'
import { buildStyleConditioning, GEOMETRY_PRESETS } from './engine/styleRecipes'
import { loadHistory, saveHistory } from './lib/history'
import { slugify } from './lib/naming'
import { HUNYUAN_PBR_HINTS, miniQualityProfile, normalizeGeometryPreset, QUALITY_LABELS, STYLE_DESCRIPTIONS, STYLE_LABELS } from './lib/presets'
import type { ArtStyle, AssetType, CastRecord, GenerationStage, MaterialMode, MeshInspection, MeshQuality, PerformanceMode, PrintRefineProfile, RealEngineId, ReferenceFusionMode, ReferenceImageSet, ReferenceView } from './types'

const DEFAULT_PROMPT = ''
const REFERENCE_VIEWS: ReferenceView[] = ['front', 'back', 'left', 'right', 'top', 'bottom']
const DROP_ORDER: ReferenceView[] = ['front', 'left', 'right', 'back', 'top', 'bottom']
const SHAPE_VIEWS = new Set<ReferenceView>(['front', 'left', 'back', 'right'])
const DEV_MODEL_URL = window.location.port === '5173' ? new URLSearchParams(window.location.search).get('model') ?? '' : ''
const DEFAULT_ENGINE: RealEngineId = 'hunyuan-mini'
const PRINT_SERVICE_BASE = 'http://127.0.0.1:8764'
const GAME_TRIANGLE_BUDGETS = [10000, 25000, 50000, 100000] as const
const savedEngine = (): RealEngineId => {
  const value = localStorage.getItem('forgecast-engine')
  return value && Object.hasOwn(REAL_ENGINE_DEFINITIONS, value) ? value as RealEngineId : DEFAULT_ENGINE
}
type PerformanceSetting = 'auto' | PerformanceMode
const savedPerformance = (): PerformanceSetting => {
  const value = localStorage.getItem('forgecast-performance')
  return value === 'laptop' || value === 'desktop' ? value : 'auto'
}
const initialEngineStatuses = (): UnifiedEngineStatuses => Object.fromEntries(
  (Object.keys(REAL_ENGINE_DEFINITIONS) as RealEngineId[]).map((id) => [id, {
    ...REAL_ENGINE_DEFINITIONS[id],
    installed: false,
    online: false,
    ready: false,
    active: false,
    modelDownloaded: false,
    label: 'Checking local engine…',
    detail: REAL_ENGINE_DEFINITIONS[id].description,
  }]),
) as UnifiedEngineStatuses
const isSupportedImage = (file: File) => ['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name)
const viewFromFilename = (filename: string): ReferenceView | undefined => {
  const words = filename.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
  if (words.some((word) => word === 'front' || word === 'frnt')) return 'front'
  if (words.some((word) => word === 'back' || word === 'rear')) return 'back'
  if (words.includes('left')) return 'left'
  if (words.includes('right')) return 'right'
  if (words.includes('top')) return 'top'
  if (words.some((word) => word === 'bottom' || word === 'underside' || word === 'bot')) return 'bottom'
  return undefined
}

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

const retainModel = async (sourceUrl: string) => {
  const response = await fetch(`${PRINT_SERVICE_BASE}/library/models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceUrl }),
  })
  if (!response.ok) {
    const result = await response.json().catch(() => ({ error: response.statusText })) as { error?: string }
    throw new Error(result.error || 'Could not retain the generated model')
  }
  const result = await response.json() as { url: string; bytes?: number }
  return { url: `${PRINT_SERVICE_BASE}${result.url}`, bytes: result.bytes }
}

const formatBytes = (bytes?: number) => {
  if (!bytes) return '—'
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

export default function App() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [assetType, setAssetType] = useState<AssetType>('prop')
  const [style, setStyle] = useState<ArtStyle>('miniature-sculpt')
  const [quality, setQuality] = useState<MeshQuality>('balanced')
  const [seed, setSeed] = useState(483921)
  const [materialMode, setMaterialMode] = useState<MaterialMode>('pbr')
  const [printHeightMm, setPrintHeightMm] = useState(75)
  const [printRefineProfile, setPrintRefineProfile] = useState<PrintRefineProfile>('fine')
  const [targetTriangles, setTargetTriangles] = useState(25000)
  const [selectedEngine, setSelectedEngine] = useState<RealEngineId>(savedEngine)
  const [performanceSetting, setPerformanceSetting] = useState<PerformanceSetting>(savedPerformance)
  const [stage, setStage] = useState<GenerationStage>(DEV_MODEL_URL ? 'complete' : 'idle')
  const [progress, setProgress] = useState(DEV_MODEL_URL ? 100 : 0)
  const [history, setHistory] = useState<CastRecord[]>(loadHistory)
  const [exportOpen, setExportOpen] = useState(false)
  const [referenceFiles, setReferenceFiles] = useState<ReferenceImageSet>({})
  const [referenceFusion, setReferenceFusion] = useState<ReferenceFusionMode>('front-priority')
  const [referencePreviewUrls, setReferencePreviewUrls] = useState<Partial<Record<ReferenceView, string>>>({})
  const [imageDropActive, setImageDropActive] = useState(false)
  const [wireframe, setWireframe] = useState(false)
  const [autoRotate, setAutoRotate] = useState(false)
  const [modelUrl, setModelUrl] = useState(DEV_MODEL_URL)
  const [engineMessage, setEngineMessage] = useState('')
  const [generationError, setGenerationError] = useState('')
  const [engineStatuses, setEngineStatuses] = useState<UnifiedEngineStatuses>(initialEngineStatuses)
  const [releasingGpu, setReleasingGpu] = useState(false)
  const [refiningStl, setRefiningStl] = useState(false)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null)
  const [meshInspection, setMeshInspection] = useState<MeshInspection | null>(null)
  const [inspectionLoading, setInspectionLoading] = useState(false)
  const viewerRef = useRef<AssetViewerHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const batchFileInputRef = useRef<HTMLInputElement>(null)
  const pendingReferenceView = useRef<ReferenceView>('front')
  const imageDragDepth = useRef(0)
  const previousEngine = useRef<RealEngineId>(selectedEngine)
  const pendingThumbnailId = useRef<string | undefined>(undefined)
  const legacyRecoveryStarted = useRef(false)
  const running = stage !== 'idle' && stage !== 'complete'
  const referenceCount = Object.keys(referenceFiles).length
  const shapeReferenceCount = REFERENCE_VIEWS.filter((view) => SHAPE_VIEWS.has(view) && referenceFiles[view]).length
  const realEngine = engineStatuses[selectedEngine]
  const engineDefinition = REAL_ENGINE_DEFINITIONS[selectedEngine]
  const hardware = engineStatuses['hunyuan-mini'].hardware
  const resolvedPerformance: PerformanceMode = performanceSetting === 'auto' ? hardware?.profile ?? 'laptop' : performanceSetting
  const laptopMode = resolvedPerformance === 'laptop'
  const miniProfile = miniQualityProfile(quality, laptopMode)
  const geometryPreset = GEOMETRY_PRESETS[style]
  const displayTriangles = materialMode === 'pbr' ? targetTriangles : Math.max(4000, Math.round((selectedEngine === 'hunyuan-mini' ? miniProfile.triangles : QUALITY_LABELS[quality].triangles) * geometryPreset.targetTriangleRatio))
  const liveTextureSize = laptopMode ? 1024 : 2048
  const desktopEngineBlocked = laptopMode && selectedEngine !== 'hunyuan-mini'
  const engineStarting = realEngine.installed && !realEngine.ready
  const multiViewInstalling = selectedEngine === 'hunyuan-mini' && realEngine.ready && referenceCount > 1 && referenceFusion === 'full' && !realEngine.multiViewDownloaded
  const hunyuanPaintBlocked = selectedEngine === 'hunyuan-2.1' && materialMode === 'pbr' && realEngine.ready && realEngine.paintAvailable === false
  const hasPbrOutput = Boolean(modelUrl) && materialMode === 'pbr'
  const selectedLibraryRecord = history.find((record) => record.id === selectedLibraryId)
  const filteredHistory = history.filter((record) => {
    if (favoritesOnly && !record.favorite) return false
    const query = libraryQuery.trim().toLowerCase()
    if (!query) return true
    return `${record.displayName ?? ''} ${record.prompt} ${record.engine} ${STYLE_LABELS[record.style]}`.toLowerCase().includes(query)
  })

  const selectReferenceFile = useCallback((view: ReferenceView, file: File | null) => {
    if (!file) return
    if (!isSupportedImage(file)) {
      setGenerationError('Please drop a PNG, JPG, JPEG, or WEBP image.')
      return
    }
    setReferenceFiles((current) => ({ ...current, [view]: file }))
    setGenerationError('')
  }, [])

  const assignReferenceFiles = useCallback((incoming: File[]) => {
    const files = incoming.filter(isSupportedImage)
    if (files.length === 0) {
      setGenerationError('Please choose PNG, JPG, JPEG, or WEBP images.')
      return
    }
    setReferenceFiles((current) => {
      const next = { ...current }
      const unassigned: File[] = []
      files.forEach((file) => {
        const namedView = viewFromFilename(file.name)
        if (namedView && !next[namedView]) next[namedView] = file
        else unassigned.push(file)
      })
      unassigned.forEach((file) => {
        const emptyView = DROP_ORDER.find((view) => !next[view])
        if (emptyView) next[emptyView] = file
      })
      return next
    })
    setGenerationError('')
  }, [])

  const openReferencePicker = (view: ReferenceView) => {
    pendingReferenceView.current = view
    fileInputRef.current?.click()
  }

  useEffect(() => saveHistory(history), [history])

  useEffect(() => {
    if (legacyRecoveryStarted.current) return
    legacyRecoveryStarted.current = true
    const legacyCasts = history.filter((record) => !record.modelUrl && record.engineId).map(({ id, createdAt }) => ({ id, createdAt }))
    if (legacyCasts.length === 0) return
    void fetch(`${PRINT_SERVICE_BASE}/library/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ casts: legacyCasts }),
    }).then(async (response) => {
      if (!response.ok) return
      const result = await response.json() as { recovered?: Array<{ castId: string; url: string }> }
      const recovered = new Map((result.recovered ?? []).map((entry) => [entry.castId, `${PRINT_SERVICE_BASE}${entry.url}`]))
      if (recovered.size > 0) setHistory((records) => records.map((record) => recovered.has(record.id) ? { ...record, modelUrl: recovered.get(record.id) } : record))
    }).catch(() => undefined)
  }, [history])

  const capturePendingThumbnail = useCallback(() => {
    const recordId = pendingThumbnailId.current
    if (!recordId) return
    window.setTimeout(() => {
      const thumbnail = viewerRef.current?.captureThumbnail()
      if (!thumbnail) return
      pendingThumbnailId.current = undefined
      setHistory((records) => records.map((record) => record.id === recordId ? { ...record, thumbnail } : record))
    }, 300)
  }, [])

  useEffect(() => {
    const urls: Partial<Record<ReferenceView, string>> = {}
    Object.entries(referenceFiles).forEach(([view, file]) => {
      if (file) urls[view as ReferenceView] = URL.createObjectURL(file)
    })
    setReferencePreviewUrls(urls)
    return () => Object.values(urls).forEach((url) => URL.revokeObjectURL(url))
  }, [referenceFiles])

  useEffect(() => {
    const hasImage = (event: DragEvent) => Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === 'file' && (!item.type || item.type.startsWith('image/')))
    const onDragEnter = (event: DragEvent) => {
      if (!hasImage(event)) return
      event.preventDefault()
      imageDragDepth.current += 1
      setImageDropActive(true)
    }
    const onDragOver = (event: DragEvent) => {
      if (!hasImage(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (event: DragEvent) => {
      event.preventDefault()
      imageDragDepth.current = Math.max(0, imageDragDepth.current - 1)
      if (imageDragDepth.current === 0) setImageDropActive(false)
    }
    const onDrop = (event: DragEvent) => {
      event.preventDefault()
      imageDragDepth.current = 0
      setImageDropActive(false)
      const files = Array.from(event.dataTransfer?.files ?? []).filter(isSupportedImage)
      if (files.length === 0) {
        setGenerationError('Please drop PNG, JPG, JPEG, or WEBP images.')
        return
      }
      assignReferenceFiles(files)
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [assignReferenceFiles])

  useEffect(() => {
    localStorage.setItem('forgecast-engine', selectedEngine)
    setGenerationError('')
    if (previousEngine.current !== selectedEngine) {
      previousEngine.current = selectedEngine
      setModelUrl('')
    }
    if (selectedEngine === 'trellis-2') setMaterialMode('pbr')
  }, [selectedEngine])

  useEffect(() => {
    localStorage.setItem('forgecast-performance', performanceSetting)
  }, [performanceSetting])

  useEffect(() => {
    if (!desktopEngineBlocked) void activateRealEngine(selectedEngine)
  }, [desktopEngineBlocked, selectedEngine])

  useEffect(() => {
    let active = true
    const check = async () => {
      const status = await detectRealEngines()
      if (active) setEngineStatuses(status)
    }
    void check()
    const timer = window.setInterval(check, 5000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (!laptopMode || selectedEngine !== 'hunyuan-mini' || running || stage !== 'complete') return
    const timer = window.setTimeout(() => { void releaseRealEngineGpu('hunyuan-mini') }, 3 * 60 * 1000)
    return () => window.clearTimeout(timer)
  }, [laptopMode, running, selectedEngine, stage])

  const releaseGpu = async () => {
    if (running || releasingGpu) return
    setReleasingGpu(true)
    const released = await releaseRealEngineGpu(selectedEngine)
    setEngineMessage(released ? 'GPU memory released. The model will reload on the next cast.' : 'Could not release the GPU worker.')
    setReleasingGpu(false)
  }

  const statusText = useMemo(() => {
    if (/GPU (memory|worker)|^(Refining STL|STL ready)/i.test(engineMessage)) return engineMessage
    if (stage === 'idle') return realEngine.ready ? `${engineDefinition.name} ready` : 'Demo preview ready'
    if (stage === 'complete') return modelUrl ? 'Real asset generated locally' : 'Demo preview complete · no AI model generated'
    return engineMessage || `Simulating ${stage} stage`
  }, [stage, engineMessage, modelUrl, realEngine.ready, engineDefinition.name])

  const startCast = async () => {
    if (running) return
    if (desktopEngineBlocked) {
      setGenerationError(`${engineDefinition.name} is reserved for the 4090 desktop. Choose Hunyuan Mini, or change Performance profile to Desktop full if you want to override the safety check.`)
      return
    }
    if (!referenceFiles.front && realEngine.ready) {
      setGenerationError('Add a front reference first. It anchors the other views to the same object and pose.')
      openReferencePicker('front')
      return
    }
    if (referenceCount > 1 && referenceFusion === 'full' && !engineDefinition.supportsMultiView) {
      setGenerationError(`${engineDefinition.name} accepts one front reference. Choose Front only or switch to Hunyuan3D 2 Mini for turntable fusion.`)
      return
    }
    if (selectedEngine === 'hunyuan-mini' && referenceCount > 1 && referenceFusion === 'full' && !realEngine.multiViewDownloaded) {
      setGenerationError('The Hunyuan Mini multi-view model is still installing. Forgecast will enable fusion automatically when it is ready.')
      return
    }
    if (hunyuanPaintBlocked) {
      setGenerationError('Hunyuan3D Paint is not installed yet. Run setup-hunyuan21.ps1 again or choose Shape only.')
      return
    }
    const runRealEngine = realEngine.ready && referenceCount > 0
    const settings = { prompt, assetType, style, quality, seed, materialMode, referenceFusion, engineId: selectedEngine, performanceMode: resolvedPerformance, printHeightMm, printRefineProfile, targetTriangles }
    const previousModelUrl = modelUrl
    setProgress(1)
    setStage('concept')
    setExportOpen(false)
    setGenerationError('')
    setEngineMessage(runRealEngine ? 'Preparing local AI engine…' : 'Simulating concept stage')
    try {
      if (runRealEngine && previousModelUrl) {
        setModelUrl('')
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())))
      }
      const onProgress = ({ percent, stage: nextStage, message }: { percent: number; stage: Exclude<GenerationStage, 'idle' | 'complete'>; message: string }) => {
        setProgress(percent)
        setStage(nextStage)
        setEngineMessage(message)
      }
      const result = runRealEngine
        ? await generateWithRealEngine(selectedEngine, referenceFiles, settings, onProgress)
        : await mockEngine.generate(settings, onProgress)
      const recordId = crypto.randomUUID()
      let retainedModelUrl = result.modelUrl ?? ''
      let retainedModelBytes: number | undefined
      if (result.modelUrl) {
        try {
          setEngineMessage('Saving model to the local library…')
          const retained = await retainModel(result.modelUrl)
          retainedModelUrl = retained.url
          retainedModelBytes = retained.bytes
        } catch (archiveError) {
          console.warn('Model library archive failed; keeping the engine URL', archiveError)
        }
      }
      const record: CastRecord = {
        id: recordId,
        ...settings,
        engineId: runRealEngine ? selectedEngine : undefined,
        engine: result.engine,
        triangles: result.triangles,
        modelUrl: retainedModelUrl || undefined,
        modelBytes: retainedModelBytes,
        createdAt: new Date().toISOString(),
      }
      setHistory((items) => [record, ...items])
      setSelectedLibraryId(recordId)
      pendingThumbnailId.current = retainedModelUrl ? recordId : undefined
      setModelUrl(retainedModelUrl)
      setStage('complete')
    } catch (error) {
      console.error('Cast failed', error)
      setGenerationError(error instanceof Error ? error.message : 'Generation failed')
      setProgress(0)
      setStage('idle')
      setModelUrl(previousModelUrl)
    }
  }

  const restoreCast = (record: CastRecord) => {
    setPrompt(record.prompt)
    setAssetType(record.assetType)
    setStyle(normalizeGeometryPreset(record.style))
    setQuality(record.quality)
    setSeed(record.seed)
    setMaterialMode(record.materialMode ?? 'pbr')
    setPrintHeightMm(record.printHeightMm ?? 75)
    setPrintRefineProfile(record.printRefineProfile ?? 'fine')
    setTargetTriangles(record.targetTriangles ?? (record.materialMode === 'shape-only' ? 25000 : record.triangles || 25000))
    if (record.performanceMode) setPerformanceSetting(record.performanceMode)
    setReferenceFusion(record.referenceFusion ?? 'front-priority')
    if (record.engineId) setSelectedEngine(record.engineId)
    pendingThumbnailId.current = record.modelUrl && !record.thumbnail ? record.id : undefined
    setModelUrl(record.modelUrl ?? '')
    setProgress(100)
    setStage('complete')
  }

  const exportRecipe = () => {
    const recipe = {
      version: 1,
      prompt,
      assetType,
      style,
      quality,
      seed,
      materialMode,
      performanceMode: resolvedPerformance,
      printHeightMm,
      printRefineProfile,
      targetTriangles,
      referenceFusion,
      engine: modelUrl ? selectedEngine : 'mock',
      referenceViews: Object.keys(referenceFiles),
      conditioning: buildStyleConditioning(prompt, assetType, style),
      generatedAt: new Date().toISOString(),
    }
    downloadBlob(new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' }), `${slugify(prompt)}.forgecast.json`)
  }

  const exportQuickStl = () => {
    const object = viewerRef.current?.getObject()
    if (!object) return
    const data = new STLExporter().parse(object, { binary: true })
    downloadBlob(new Blob([data], { type: 'model/stl' }), `${slugify(prompt)}.stl`)
  }

  useEffect(() => {
    setMeshInspection(null)
    const url = selectedLibraryRecord?.modelUrl
    if (!url?.startsWith(`${PRINT_SERVICE_BASE}/library/models/`)) return
    let cancelled = false
    setInspectionLoading(true)
    void fetch(`${url}/stats`).then(async (response) => {
      if (!response.ok) throw new Error('Mesh inspection failed')
      const stats = await response.json() as MeshInspection
      if (!cancelled) setMeshInspection(stats)
    }).catch(() => undefined).finally(() => { if (!cancelled) setInspectionLoading(false) })
    return () => { cancelled = true }
  }, [selectedLibraryRecord?.id, selectedLibraryRecord?.modelUrl])

  const openLibraryRecord = (record: CastRecord) => {
    setSelectedLibraryId(record.id)
    restoreCast(record)
  }

  const updateSelectedRecord = (changes: Partial<CastRecord>) => {
    if (!selectedLibraryId) return
    setHistory((records) => records.map((record) => record.id === selectedLibraryId ? { ...record, ...changes } : record))
  }

  const downloadLibraryModel = async (record: CastRecord) => {
    if (!record.modelUrl) return
    const response = await fetch(record.modelUrl)
    if (!response.ok) return
    downloadBlob(await response.blob(), `${slugify(record.displayName || record.prompt || 'forgecast-asset')}.glb`)
  }

  const deleteLibraryRecord = async (record: CastRecord) => {
    if (!window.confirm(`Delete “${record.displayName || record.prompt || 'Untitled asset'}” from the Forgecast library? This removes its retained GLB from disk.`)) return
    if (record.modelUrl?.startsWith(`${PRINT_SERVICE_BASE}/library/models/`)) {
      await fetch(record.modelUrl, { method: 'DELETE' }).catch(() => undefined)
    }
    setHistory((records) => records.filter((item) => item.id !== record.id))
    if (selectedLibraryId === record.id) {
      setSelectedLibraryId(null)
      setMeshInspection(null)
      if (modelUrl === record.modelUrl) setModelUrl('')
    }
  }

  const exportStl = async () => {
    if (!modelUrl) {
      exportQuickStl()
      return
    }
    if (refiningStl) return
    setRefiningStl(true)
    setExportOpen(false)
    setGenerationError('')
    setEngineMessage('Refining STL geometry for printing…')
    try {
      const refinedResponse = await fetch(`${PRINT_SERVICE_BASE}/refine-stl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceUrl: modelUrl, heightMm: printHeightMm, profile: printRefineProfile, geometryPreset: style }),
      })
      if (!refinedResponse.ok) {
        const message = await refinedResponse.json().catch(() => ({ error: refinedResponse.statusText })) as { error?: string }
        throw new Error(message.error || 'STL refinement failed')
      }
      const result = await refinedResponse.json() as { url: string; stats?: { outputFaces?: number; removedComponents?: number; watertight?: boolean } }
      const stlResponse = await fetch(`${PRINT_SERVICE_BASE}${result.url}`)
      if (!stlResponse.ok) throw new Error('The refined STL could not be downloaded')
      downloadBlob(await stlResponse.blob(), `${slugify(prompt)}-${printHeightMm}mm-${printRefineProfile}.stl`)
      const faces = result.stats?.outputFaces ? `${result.stats.outputFaces.toLocaleString()} faces` : 'refined geometry'
      const solidity = result.stats?.watertight ? 'watertight' : 'slicer repair may still be needed'
      setEngineMessage(`STL ready · ${faces} · ${printHeightMm} mm · ${solidity}`)
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : 'STL refinement failed')
      setEngineMessage('')
    } finally {
      setRefiningStl(false)
    }
  }

  const exportGlb = () => {
    const object = viewerRef.current?.getObject()
    if (!object) return
    const restoreLiveTextures = viewerRef.current?.preparePbrExport(2048) ?? (() => undefined)
    new GLTFExporter().parse(
      object,
      (data) => {
        restoreLiveTextures()
        downloadBlob(new Blob([data as ArrayBuffer], { type: 'model/gltf-binary' }), `${slugify(prompt)}.glb`)
      },
      (error) => {
        restoreLiveTextures()
        console.error('GLB export failed', error)
      },
      { binary: true, onlyVisible: true },
    )
  }

  return (
    <main className="app-shell">
      {imageDropActive && <div className="image-drop-overlay"><div><ImagePlus size={34} /><strong>Drop reference images</strong><span>Multiple files fill the next empty view slots</span></div></div>}
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <div><strong>FORGECAST</strong><span>LOCAL 3D STUDIO</span></div>
        </div>
        <div className="topbar__center"><span className={`status-light ${realEngine.ready ? '' : 'status-light--demo'}`} /> {realEngine.ready ? 'LOCAL AI ENGINE' : engineStarting ? 'ENGINE STARTING' : 'DEMO ENGINE'} <strong>{realEngine.label.toUpperCase()}</strong></div>
        <button className="icon-button" aria-label="Settings"><Settings2 size={18} /></button>
      </header>

      <section className="workspace">
        <aside className="control-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">NEW CAST</span><h1>Shape an asset</h1></div>
            <button className="icon-button small" title="Randomize seed" onClick={() => setSeed(Math.floor(Math.random() * 999999))}><RefreshCw size={15} /></button>
          </div>

          {selectedEngine !== 'trellis-2' && <div className="field-group output-target">
            <label>Output target</label>
            <div className="output-choice" role="group" aria-label="Output target">
              <button className={materialMode === 'pbr' ? 'active' : ''} type="button" disabled={selectedEngine === 'hunyuan-2.1' && realEngine.paintAvailable === false} onClick={() => setMaterialMode('pbr')}><Box size={16} /><span><strong>Game asset</strong><small>Color GLB · optimized mesh</small></span></button>
              <button className={materialMode === 'shape-only' ? 'active' : ''} type="button" onClick={() => setMaterialMode('shape-only')}><Layers3 size={16} /><span><strong>Print model</strong><small>Raw shape · refined STL</small></span></button>
            </div>
          </div>}

          <div className="field-group">
            <label htmlFor="prompt">Asset name / notes</label>
            <div className="prompt-box">
              <textarea id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={500} />
              <span>{prompt.length}/500</span>
            </div>
          </div>

          <input ref={fileInputRef} className="file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { selectReferenceFile(pendingReferenceView.current, event.target.files?.[0] ?? null); event.target.value = '' }} />
          <input ref={batchFileInputRef} className="file-input" type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(event) => { assignReferenceFiles(Array.from(event.target.files ?? [])); event.target.value = '' }} />
          <div className="field-group reference-set">
            <div className="reference-set__heading"><label>Reference views</label><div><button type="button" onClick={() => batchFileInputRef.current?.click()}>Add several</button><span>{referenceCount}/6</span></div></div>
            <div className="reference-grid">
              {REFERENCE_VIEWS.map((view) => {
                const file = referenceFiles[view]
                const preview = referencePreviewUrls[view]
                return <button className={`reference-slot ${file ? 'reference-slot--ready' : ''}`} key={view} onClick={() => openReferencePicker(view)} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy' }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); imageDragDepth.current = 0; setImageDropActive(false); const dropped = Array.from(event.dataTransfer.files).find(isSupportedImage); selectReferenceFile(view, dropped ?? null) }}>
                  {preview ? <img src={preview} alt={`${view} reference`} /> : <ImagePlus size={16} />}
                  <span><strong>{view}</strong><small>{file ? file.name : SHAPE_VIEWS.has(view) ? 'Shape + color' : 'Color guide'}</small></span>
                </button>
              })}
            </div>
            {referenceCount > 1 && <div className="fusion-mode" role="group" aria-label="Reference fusion mode">
              <button className={referenceFusion === 'front-priority' ? 'active' : ''} type="button" onClick={() => setReferenceFusion('front-priority')}><strong>Front only</strong><span>Best quality · ignores others</span></button>
              <button className={referenceFusion === 'full' ? 'active' : ''} type="button" onClick={() => setReferenceFusion('full')}><strong>Full fusion</strong><span>Exact turntables only</span></button>
            </div>}
            <div className="reference-set__note"><strong>{referenceFusion === 'front-priority' ? 'Front-only cast:' : 'Full shape fusion:'}</strong> {referenceFusion === 'front-priority' ? 'front controls both geometry and color · other slots are ignored' : 'front · left · back · right geometry'} <span>{referenceFusion === 'front-priority' ? 'Choose Full fusion only for exact turntable renders.' : 'Top/bottom guide color coverage.'}</span></div>
          </div>

          <div className="field-group">
            <label>Asset type</label>
            <div className="segmented">
              {(['prop', 'character', 'creature'] as AssetType[]).map((type) => <button className={assetType === type ? 'active' : ''} key={type} onClick={() => setAssetType(type)}>{type}</button>)}
            </div>
          </div>

          <div className="field-group">
            <label>Geometry preset</label>
            <div className="style-grid">
              {(Object.keys(STYLE_LABELS) as ArtStyle[]).map((key, index) => (
                <button className={`style-card style-card--${index + 1} ${style === key ? 'active' : ''}`} key={key} onClick={() => setStyle(key)}>
                  <span className="style-card__swatch" /><span className="style-card__copy"><strong>{STYLE_LABELS[key]}</strong><small>{STYLE_DESCRIPTIONS[key]}</small></span>{style === key && <Check size={13} />}
                </button>
              ))}
            </div>
            <div className="baked-style-note"><Sparkles size={12} /> {STYLE_DESCRIPTIONS[style]} · affects shape guides, mesh budget and STL processing</div>
          </div>

          <div className="field-group">
            <label>Reconstruction detail</label><div className="select-wrap"><select value={quality} onChange={(event) => setQuality(event.target.value as MeshQuality)}>{(Object.keys(QUALITY_LABELS) as MeshQuality[]).map((key) => {
              const mini = miniQualityProfile(key, laptopMode)
              return <option value={key} key={key}>{QUALITY_LABELS[key].label} · {mini.octreeResolution} grid · {mini.inferenceSteps} steps</option>
            })}</select><ChevronDown size={14} /></div>
            <small className="field-help">Controls how carefully the AI reconstructs the shape. It does not set the final game mesh size.</small>
          </div>

          {selectedEngine === 'hunyuan-2.1' && materialMode === 'pbr' && <div className="baked-style-note"><Sparkles size={12} /> {HUNYUAN_PBR_HINTS[quality]}</div>}

          {materialMode === 'pbr' && <div className="field-group budget-panel">
            <div className="budget-panel__heading"><div><label>Game mesh budget</label><small>Final target</small></div><strong>{targetTriangles.toLocaleString()} <span>tris</span></strong></div>
            <div className="budget-options" role="group" aria-label="Game mesh triangle budget">
              {GAME_TRIANGLE_BUDGETS.map((budget) => <button type="button" className={targetTriangles === budget ? 'active' : ''} key={budget} onClick={() => setTargetTriangles(budget)}><strong>{budget / 1000}K</strong><span>{budget === 10000 ? 'Light' : budget === 25000 ? 'Game' : budget === 50000 ? 'Hero' : 'High'}</span></button>)}
            </div>
            <div className="budget-panel__note"><Layers3 size={12} /> Reconstruction can stay high while the exported GLB is reduced to this budget.</div>
          </div>}

          {materialMode === 'shape-only' && <div className="field-group settings-row print-settings-row">
            <div><label>Export height</label><div className="print-size-input"><input className="seed-input" value={printHeightMm} min={10} max={500} step={1} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setPrintHeightMm(Math.max(10, Math.min(500, Number(event.target.value) || 10)))} type="number" /><span>mm</span></div></div>
            <div><label>STL export refinement</label><div className="select-wrap"><select value={printRefineProfile} onChange={(event) => setPrintRefineProfile(event.target.value as PrintRefineProfile)}><option value="fine">Fine detail</option><option value="balanced">Balanced cleanup</option></select><ChevronDown size={14} /></div></div>
          </div>}
          {materialMode === 'shape-only' && <div className="baked-style-note"><Sparkles size={12} /> Export only · Fine detail preserves existing features while repairing the downloaded STL; it cannot invent detail missing from the raw preview.</div>}
          {quality === 'ultra' && <div className="baked-style-note"><Clock3 size={12} /> Ultra uses a {miniProfile.octreeResolution} reconstruction grid and {miniProfile.inferenceSteps} shape steps. Expect a substantially longer cast.</div>}

          <details className="advanced-panel">
            <summary><span><Settings2 size={14} /> Engine & advanced settings</span><ChevronDown size={14} /></summary>
            <div className="advanced-panel__body">
              <div className="field-group engine-picker">
                <label htmlFor="engine">Generation engine</label>
                <div className="select-wrap"><select id="engine" value={selectedEngine} onChange={(event) => setSelectedEngine(event.target.value as RealEngineId)}>{(Object.keys(REAL_ENGINE_DEFINITIONS) as RealEngineId[]).map((id) => <option value={id} key={id}>{REAL_ENGINE_DEFINITIONS[id].name}{laptopMode && id !== 'hunyuan-mini' ? ' · desktop only' : engineStatuses[id].installed ? '' : ' · not installed'}</option>)}</select><ChevronDown size={14} /></div>
                <small><strong>{engineDefinition.output}</strong> · {engineDefinition.description}</small>
              </div>
              <div className="field-group engine-picker">
                <label htmlFor="performance">Performance profile</label>
                <div className="select-wrap"><select id="performance" value={performanceSetting} onChange={(event) => setPerformanceSetting(event.target.value as PerformanceSetting)}><option value="auto">Auto · {hardware?.profile === 'desktop' ? 'desktop full' : 'laptop safe'}</option><option value="laptop">Laptop safe</option><option value="desktop">Desktop full</option></select><ChevronDown size={14} /></div>
                <small>{hardware?.gpuName ? `${hardware.gpuName}${hardware.vramMb ? ` · ${(hardware.vramMb / 1024).toFixed(1)} GB VRAM` : ''}` : 'Safe laptop limits are used until GPU detection is available.'}</small>
              </div>
              <div className="field-group"><label>Seed</label><input className="seed-input" value={seed} onChange={(event) => setSeed(Number(event.target.value))} type="number" /></div>
            </div>
          </details>

          {desktopEngineBlocked && <div className="baked-style-note"><Cpu size={12} /> Desktop-only engine blocked by Laptop safe mode. Use Hunyuan Mini here, or explicitly choose Desktop full to override.</div>}

          <div className={`engine-note ${realEngine.ready ? 'engine-note--ready' : ''}`}><Cpu size={16} /><span><strong>{realEngine.ready ? (referenceCount > 1 ? (referenceFusion === 'front-priority' || !engineDefinition.supportsMultiView ? 'Front-only generation ready' : multiViewInstalling ? 'Multi-view model is installing' : `${shapeReferenceCount}-view full fusion ready`) : referenceFiles.front ? `${engineDefinition.shortName} ready` : 'Add a front reference') : engineStarting ? `${engineDefinition.shortName} is starting` : 'Demo mode only — prompts are not generated'}</strong><small>{realEngine.ready ? (referenceCount > 1 && (referenceFusion === 'front-priority' || !engineDefinition.supportsMultiView) ? 'Uses the front reference; other loaded slots are ignored by this engine.' : realEngine.detail) : engineStarting ? 'The engine manager is switching workers. This usually takes a few seconds; model weights load on the first cast.' : `${realEngine.label}. ${realEngine.detail}`}</small></span></div>
          {generationError && <div className="generation-error">{generationError}</div>}

          <button className="cast-button" onClick={startCast} disabled={running || refiningStl || multiViewInstalling || engineStarting || hunyuanPaintBlocked || desktopEngineBlocked}>
            {running ? <><RefreshCw className="spin" size={18} /> {realEngine.ready ? 'GENERATING' : 'SIMULATING'} · {progress}%</> : <><WandSparkles size={19} /> {desktopEngineBlocked ? 'DESKTOP ENGINE · CHANGE PROFILE' : engineStarting ? 'STARTING ENGINE' : realEngine.ready ? (multiViewInstalling ? 'INSTALLING MULTI-VIEW MODEL' : referenceCount > 1 ? (referenceFusion === 'front-priority' || !engineDefinition.supportsMultiView ? `CAST WITH ${engineDefinition.shortName.toUpperCase()}` : `FUSE ${referenceCount} REFERENCES`) : referenceFiles.front ? `CAST WITH ${engineDefinition.shortName.toUpperCase()}` : 'ADD FRONT REFERENCE') : (stage === 'complete' ? 'RE-RUN DEMO' : 'RUN DEMO PREVIEW')}</>}
          </button>
        </aside>

        <section className="viewer-panel">
          <div className="viewer-toolbar">
            <div><span className="pill"><Box size={13} /> {assetType}</span><span className="pill"><Layers3 size={13} /> {materialMode === 'shape-only' ? 'Raw print mesh' : `${displayTriangles.toLocaleString()} tri target`}</span>{modelUrl && <span className="pill"><Sparkles size={13} /> {hasPbrOutput ? `${liveTextureSize / 1024}K live PBR` : `${printHeightMm} mm print`}</span>}</div>
            <div><button className="tool-button" disabled={running || refiningStl || releasingGpu || !realEngine.online} onClick={releaseGpu}><Cpu size={15} /> {releasingGpu ? 'Releasing…' : 'Free GPU'}</button><button className={`tool-button ${autoRotate ? 'active' : ''}`} onClick={() => setAutoRotate((value) => !value)}><Rotate3D size={15} /> {autoRotate ? 'Rotating' : 'Orbit'}</button><button className={`tool-button ${wireframe ? 'active' : ''}`} onClick={() => setWireframe((value) => !value)}>Wireframe</button></div>
          </div>
          <div className="viewer-canvas">{!modelUrl && <div className="demo-watermark"><strong>DEMO GEOMETRY</strong><span>Not generated from your prompt</span></div>}<AssetViewer ref={viewerRef} type={assetType} style={style} wireframe={wireframe} autoRotate={autoRotate} modelUrl={modelUrl || undefined} detailTextureSize={liveTextureSize} proceduralPbr={materialMode === 'pbr'} onModelReady={capturePendingThumbnail} /></div>
          <div className="viewer-caption"><span>Drag to orbit · Scroll to zoom · Right-drag to pan</span><span>{modelUrl ? 'Real local AI output' : 'Procedural demo geometry'}</span></div>

          <div className="generation-dock">
            <div className="dock-status">
              <div className={`dock-icon ${stage === 'complete' ? 'complete' : ''}`}>{stage === 'complete' ? <Check size={18} /> : <Sparkles size={18} />}</div>
              <div><span className="eyebrow">CURRENT JOB</span><strong>{statusText}</strong></div>
            </div>
            <div className="progress-wrap"><StageRail stage={stage} /><div className="progress-track"><span style={{ width: `${progress}%` }} /></div></div>
            <div className="export-wrap">
              <button className="export-button" disabled={stage !== 'complete' || refiningStl} onClick={() => setExportOpen((value) => !value)}><Download size={16} /> {refiningStl ? 'Refining STL…' : 'Export'} <ChevronDown size={14} /></button>
              {exportOpen && <div className="export-menu"><button onClick={exportGlb}>{hasPbrOutput ? '2K PBR Color GLB' : modelUrl ? 'Geometry GLB' : 'Demo GLB'} <span>{hasPbrOutput ? 'Temporarily builds final 2K material maps' : modelUrl ? 'Mesh with its generated material data' : 'Procedural colors'}</span></button><button onClick={() => { void exportStl() }}>{modelUrl ? 'Refined Print STL' : 'Demo STL'} <span>{modelUrl ? `${printHeightMm} mm · repair holes, normals and floaters` : 'Geometry only · no color'}</span></button><button onClick={exportRecipe}>Recipe <span>Prompt + settings</span></button><button disabled>FBX <span>Coming later</span></button></div>}
            </div>
          </div>
        </section>

        <aside className="history-panel">
          <div className="history-heading"><div><span className="eyebrow">ASSET LIBRARY</span><h2>Saved casts</h2></div><span>{history.length}</span></div>
          <div className="library-toolbar">
            <label><Search size={13} /><input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="Search assets" /></label>
            <button className={favoritesOnly ? 'active' : ''} type="button" title="Show favorites only" onClick={() => setFavoritesOnly((value) => !value)}><Heart size={14} fill={favoritesOnly ? 'currentColor' : 'none'} /></button>
          </div>
          {selectedLibraryRecord && <section className="library-inspector">
            <div className="library-inspector__hero">{selectedLibraryRecord.thumbnail ? <img src={selectedLibraryRecord.thumbnail} alt="Selected asset preview" /> : <Box size={34} />}</div>
            <input className="library-name" aria-label="Asset name" value={selectedLibraryRecord.displayName ?? selectedLibraryRecord.prompt ?? ''} placeholder="Untitled asset" onChange={(event) => updateSelectedRecord({ displayName: event.target.value })} />
            <div className="library-inspector__source"><span>{selectedLibraryRecord.engine}</span><span>{QUALITY_LABELS[selectedLibraryRecord.quality].label}</span></div>
            {inspectionLoading && <div className="inspection-loading"><RefreshCw className="spin" size={12} /> Inspecting retained mesh…</div>}
            {meshInspection && <dl className="mesh-stats">
              <div><dt>Triangles</dt><dd>{meshInspection.triangles.toLocaleString()}</dd></div>
              <div><dt>Vertices</dt><dd>{meshInspection.vertices.toLocaleString()}</dd></div>
              <div><dt>Parts</dt><dd>{meshInspection.components}</dd></div>
              <div><dt>Materials</dt><dd>{meshInspection.materials}</dd></div>
              <div><dt>File size</dt><dd>{formatBytes(meshInspection.fileBytes)}</dd></div>
              <div><dt>Manifold</dt><dd className={meshInspection.watertight ? 'stat-good' : 'stat-warn'}>{meshInspection.watertight ? 'Watertight' : 'Open mesh'}</dd></div>
            </dl>}
            {!inspectionLoading && !meshInspection && <div className="inspection-loading"><HardDrive size={12} /> {selectedLibraryRecord.modelUrl ? `${formatBytes(selectedLibraryRecord.modelBytes)} retained model` : 'Settings only · model unavailable'}</div>}
            <div className="library-actions">
              <button className={selectedLibraryRecord.favorite ? 'active' : ''} type="button" onClick={() => updateSelectedRecord({ favorite: !selectedLibraryRecord.favorite })}><Heart size={13} fill={selectedLibraryRecord.favorite ? 'currentColor' : 'none'} /> Favorite</button>
              <button type="button" disabled={!selectedLibraryRecord.modelUrl} onClick={() => { void downloadLibraryModel(selectedLibraryRecord) }}><Download size={13} /> GLB</button>
              <button className="danger" type="button" onClick={() => { void deleteLibraryRecord(selectedLibraryRecord) }}><Trash2 size={13} /> Delete</button>
            </div>
          </section>}
          <div className="history-list">
            {history.length === 0 && <div className="empty-history"><Clock3 size={28} /><strong>No casts yet</strong><span>Your generated assets and recipes will appear here.</span></div>}
            {history.length > 0 && filteredHistory.length === 0 && <div className="empty-history empty-history--compact"><Search size={20} /><strong>No matches</strong><span>Try another search or turn off favorites.</span></div>}
            {filteredHistory.map((record, index) => (
              <button className={`history-card ${selectedLibraryId === record.id ? 'active' : ''}`} key={record.id} onClick={() => openLibraryRecord(record)}>
                <span className={`history-thumb history-thumb--${record.assetType}`}>{record.thumbnail ? <img src={record.thumbnail} alt="" /> : <Box size={22} />}</span>
                <span className="history-copy"><strong>{record.displayName || record.prompt || 'Untitled asset'}</strong><small>{STYLE_LABELS[record.style]} · {record.triangles / 1000}K tris{record.modelUrl ? ' · saved' : ''}</small></span>
                {record.favorite && <Heart className="history-favorite" size={10} fill="currentColor" />}
                {index === 0 && <span className="new-dot" />}
              </button>
            ))}
          </div>
          <div className="system-card">
            <div><span className="status-light" /><strong>System ready</strong></div>
            <dl><dt>GPU</dt><dd>{hardware?.gpuName || 'Local NVIDIA GPU'}</dd><dt>Profile</dt><dd>{laptopMode ? 'Laptop safe' : 'Desktop full'}</dd><dt>Engine</dt><dd>{realEngine.ready ? engineDefinition.shortName : engineStarting ? 'Starting…' : 'Demo adapter'}</dd><dt>Queue</dt><dd>{running ? '1 active' : 'Idle'}</dd></dl>
          </div>
        </aside>
      </section>

      <footer><span>FORGECAST 0.3.0 · MULTI-ENGINE LOCAL STUDIO</span><span><Play size={11} fill="currentColor" /> Engine logs</span></footer>
    </main>
  )
}
