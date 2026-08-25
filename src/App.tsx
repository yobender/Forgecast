import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Check, ChevronDown, Clock3, Cpu, Download, ImagePlus, Layers3, Play, RefreshCw, Rotate3D, Settings2, Sparkles, WandSparkles } from 'lucide-react'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { STLExporter } from 'three/addons/exporters/STLExporter.js'
import { AssetViewer, type AssetViewerHandle } from './components/AssetViewer'
import { BrandMark } from './components/BrandMark'
import { StageRail } from './components/StageRail'
import { mockEngine } from './engine/mockEngine'
import { detectRealEngine, generateRealMesh, type RealEngineStatus } from './engine/modlyEngine'
import { buildStyleConditioning } from './engine/styleRecipes'
import { loadHistory, saveHistory } from './lib/history'
import { slugify } from './lib/naming'
import { QUALITY_LABELS, STYLE_LABELS } from './lib/presets'
import type { ArtStyle, AssetType, CastRecord, GenerationStage, MeshQuality, ReferenceFusionMode, ReferenceImageSet, ReferenceView } from './types'

const DEFAULT_PROMPT = ''
const REFERENCE_VIEWS: ReferenceView[] = ['front', 'back', 'left', 'right', 'top', 'bottom']
const DROP_ORDER: ReferenceView[] = ['front', 'left', 'right', 'back', 'top', 'bottom']
const SHAPE_VIEWS = new Set<ReferenceView>(['front', 'left', 'back', 'right'])
const DEV_MODEL_URL = window.location.port === '5173' ? new URLSearchParams(window.location.search).get('model') ?? '' : ''
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

export default function App() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [assetType, setAssetType] = useState<AssetType>('prop')
  const [style, setStyle] = useState<ArtStyle>('polygon-game')
  const [quality, setQuality] = useState<MeshQuality>('preview')
  const [seed, setSeed] = useState(483921)
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
  const [realEngine, setRealEngine] = useState<RealEngineStatus>({ apiOnline: false, modelAvailable: false, modelDownloaded: false, multiViewAvailable: false, multiViewDownloaded: false, label: 'Checking real AI engine…' })
  const viewerRef = useRef<AssetViewerHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const batchFileInputRef = useRef<HTMLInputElement>(null)
  const pendingReferenceView = useRef<ReferenceView>('front')
  const imageDragDepth = useRef(0)
  const running = stage !== 'idle' && stage !== 'complete'
  const referenceCount = Object.keys(referenceFiles).length
  const shapeReferenceCount = REFERENCE_VIEWS.filter((view) => SHAPE_VIEWS.has(view) && referenceFiles[view]).length
  const multiViewInstalling = realEngine.modelAvailable && referenceCount > 1 && referenceFusion === 'full' && !realEngine.multiViewDownloaded

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
    let active = true
    const check = async () => {
      const status = await detectRealEngine()
      if (active) setRealEngine(status)
    }
    void check()
    const timer = window.setInterval(check, 5000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  const statusText = useMemo(() => {
    if (stage === 'idle') return 'Demo preview ready'
    if (stage === 'complete') return modelUrl ? 'Real asset generated locally' : 'Demo preview complete · no AI model generated'
    return engineMessage || `Simulating ${stage} stage`
  }, [stage, engineMessage, modelUrl])

  const startCast = async () => {
    if (running) return
    if (!referenceFiles.front && realEngine.modelAvailable) {
      setGenerationError('Add a front reference first. It anchors the other views to the same object and pose.')
      openReferencePicker('front')
      return
    }
    if (referenceCount > 1 && referenceFusion === 'full' && (!realEngine.multiViewAvailable || !realEngine.multiViewDownloaded)) {
      setGenerationError('The multi-view model is still installing. Forgecast will enable fusion automatically when it is ready.')
      return
    }
    const runRealEngine = realEngine.modelAvailable && referenceCount > 0
    const settings = { prompt, assetType, style, quality, seed, referenceFusion }
    setProgress(1)
    setStage('concept')
    setExportOpen(false)
    setGenerationError('')
    setEngineMessage(runRealEngine ? 'Preparing local AI engine…' : 'Simulating concept stage')
    try {
      const onProgress = ({ percent, stage: nextStage, message }: { percent: number; stage: Exclude<GenerationStage, 'idle' | 'complete'>; message: string }) => {
        setProgress(percent)
        setStage(nextStage)
        setEngineMessage(message)
      }
      const result = runRealEngine
        ? await generateRealMesh(referenceFiles, settings, onProgress)
        : await mockEngine.generate(settings, onProgress)
      const record: CastRecord = {
        id: crypto.randomUUID(),
        ...settings,
        engine: result.engine,
        triangles: result.triangles,
        createdAt: new Date().toISOString(),
      }
      setHistory((items) => [record, ...items])
      setModelUrl(result.modelUrl ?? '')
      setStage('complete')
    } catch (error) {
      console.error('Cast failed', error)
      setGenerationError(error instanceof Error ? error.message : 'Generation failed')
      setProgress(0)
      setStage('idle')
    }
  }

  const restoreCast = (record: CastRecord) => {
    setPrompt(record.prompt)
    setAssetType(record.assetType)
    setStyle(record.style)
    setQuality(record.quality)
    setSeed(record.seed)
    setReferenceFusion(record.referenceFusion ?? 'front-priority')
    setModelUrl('')
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
      referenceFusion,
      engine: 'mock',
      referenceViews: Object.keys(referenceFiles),
      conditioning: buildStyleConditioning(prompt, assetType, style),
      generatedAt: new Date().toISOString(),
    }
    downloadBlob(new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' }), `${slugify(prompt)}.forgecast.json`)
  }

  const exportStl = () => {
    const object = viewerRef.current?.getObject()
    if (!object) return
    const data = new STLExporter().parse(object, { binary: true })
    downloadBlob(new Blob([data], { type: 'model/stl' }), `${slugify(prompt)}.stl`)
  }

  const exportGlb = () => {
    const object = viewerRef.current?.getObject()
    if (!object) return
    new GLTFExporter().parse(
      object,
      (data) => downloadBlob(new Blob([data as ArrayBuffer], { type: 'model/gltf-binary' }), `${slugify(prompt)}.glb`),
      (error) => console.error('GLB export failed', error),
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
        <div className="topbar__center"><span className={`status-light ${realEngine.modelAvailable ? '' : 'status-light--demo'}`} /> {realEngine.modelAvailable ? 'LOCAL AI ENGINE' : 'DEMO ENGINE'} <strong>{realEngine.label.toUpperCase()}</strong></div>
        <button className="icon-button" aria-label="Settings"><Settings2 size={18} /></button>
      </header>

      <section className="workspace">
        <aside className="control-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">NEW CAST</span><h1>Shape an asset</h1></div>
            <button className="icon-button small" title="Randomize seed" onClick={() => setSeed(Math.floor(Math.random() * 999999))}><RefreshCw size={15} /></button>
          </div>

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
            <label>Art direction</label>
            <div className="style-grid">
              {(Object.keys(STYLE_LABELS) as ArtStyle[]).map((key, index) => (
                <button className={`style-card style-card--${index + 1} ${style === key ? 'active' : ''}`} key={key} onClick={() => { setStyle(key); if (key === 'polygon-game') setQuality('preview') }}>
                  <span className="style-card__swatch" /><span>{STYLE_LABELS[key]}</span>{style === key && <Check size={13} />}
                </button>
              ))}
            </div>
            {style === 'polygon-game' && <div className="baked-style-note"><Sparkles size={12} /> Baked preset · faceted · chunky · game-ready silhouette</div>}
          </div>

          <div className="field-group settings-row">
            <div><label>Mesh quality</label><div className="select-wrap"><select value={quality} onChange={(event) => setQuality(event.target.value as MeshQuality)}>{(Object.keys(QUALITY_LABELS) as MeshQuality[]).map((key) => <option value={key} key={key}>{QUALITY_LABELS[key].label} · {QUALITY_LABELS[key].triangles / 1000}K</option>)}</select><ChevronDown size={14} /></div></div>
            <div><label>Seed</label><input className="seed-input" value={seed} onChange={(event) => setSeed(Number(event.target.value))} type="number" /></div>
          </div>

          <div className={`engine-note ${realEngine.modelAvailable ? 'engine-note--ready' : ''}`}><Cpu size={16} /><span><strong>{realEngine.modelAvailable ? (referenceCount > 1 ? (referenceFusion === 'front-priority' ? 'Front-only generation ready' : multiViewInstalling ? 'Multi-view model is installing' : `${shapeReferenceCount}-view full fusion ready`) : referenceFiles.front ? 'Single-view generation ready' : 'Add a front reference') : 'Demo mode only — prompts are not generated'}</strong><small>{realEngine.modelAvailable ? (referenceCount > 1 && referenceFusion === 'front-priority' ? 'Uses only the front for the same clean result as a one-image cast; other loaded slots are ignored.' : `${realEngine.multiViewDownloaded ? 'Hunyuan3D multi-view is installed.' : 'Fusion unlocks when the multi-view weights finish installing.'} Full fusion needs matching scale, pose, and details.`) : 'This validates the interface with procedural test geometry. The local AI engine is offline.'}</small></span></div>
          {generationError && <div className="generation-error">{generationError}</div>}

          <button className="cast-button" onClick={startCast} disabled={running || multiViewInstalling}>
            {running ? <><RefreshCw className="spin" size={18} /> {realEngine.modelAvailable ? 'GENERATING' : 'SIMULATING'} · {progress}%</> : <><WandSparkles size={19} /> {realEngine.modelAvailable ? (multiViewInstalling ? 'INSTALLING MULTI-VIEW MODEL' : referenceCount > 1 ? (referenceFusion === 'front-priority' ? 'CAST FRONT-ONLY ASSET' : `FUSE ${referenceCount} REFERENCES`) : referenceFiles.front ? 'CAST REAL ASSET' : 'ADD FRONT REFERENCE') : (stage === 'complete' ? 'RE-RUN DEMO' : 'RUN DEMO PREVIEW')}</>}
          </button>
        </aside>

        <section className="viewer-panel">
          <div className="viewer-toolbar">
            <div><span className="pill"><Box size={13} /> {assetType}</span><span className="pill"><Layers3 size={13} /> {QUALITY_LABELS[quality].triangles.toLocaleString()} tris</span>{modelUrl && <span className="pill"><Sparkles size={13} /> 2K PBR detail</span>}</div>
            <div><button className={`tool-button ${autoRotate ? 'active' : ''}`} onClick={() => setAutoRotate((value) => !value)}><Rotate3D size={15} /> {autoRotate ? 'Rotating' : 'Orbit'}</button><button className={`tool-button ${wireframe ? 'active' : ''}`} onClick={() => setWireframe((value) => !value)}>Wireframe</button></div>
          </div>
          <div className="viewer-canvas">{!modelUrl && <div className="demo-watermark"><strong>DEMO GEOMETRY</strong><span>Not generated from your prompt</span></div>}<AssetViewer ref={viewerRef} type={assetType} style={style} wireframe={wireframe} autoRotate={autoRotate} modelUrl={modelUrl || undefined} /></div>
          <div className="viewer-caption"><span>Drag to orbit · Scroll to zoom · Right-drag to pan</span><span>{modelUrl ? 'Real local AI output' : 'Procedural demo geometry'}</span></div>

          <div className="generation-dock">
            <div className="dock-status">
              <div className={`dock-icon ${stage === 'complete' ? 'complete' : ''}`}>{stage === 'complete' ? <Check size={18} /> : <Sparkles size={18} />}</div>
              <div><span className="eyebrow">CURRENT JOB</span><strong>{statusText}</strong></div>
            </div>
            <div className="progress-wrap"><StageRail stage={stage} /><div className="progress-track"><span style={{ width: `${progress}%` }} /></div></div>
            <div className="export-wrap">
              <button className="export-button" disabled={stage !== 'complete'} onClick={() => setExportOpen((value) => !value)}><Download size={16} /> Export <ChevronDown size={14} /></button>
              {exportOpen && <div className="export-menu"><button onClick={exportGlb}>{modelUrl ? 'PBR Color GLB' : 'Demo GLB'} <span>{modelUrl ? 'Color + 2K normal/roughness maps' : 'Procedural colors'}</span></button><button onClick={exportStl}>{modelUrl ? 'Print STL' : 'Demo STL'} <span>Geometry only · no color</span></button><button onClick={exportRecipe}>Recipe <span>Prompt + settings</span></button><button disabled>FBX <span>Coming later</span></button></div>}
            </div>
          </div>
        </section>

        <aside className="history-panel">
          <div className="history-heading"><div><span className="eyebrow">LIBRARY</span><h2>Recent casts</h2></div><span>{history.length}</span></div>
          <div className="history-list">
            {history.length === 0 && <div className="empty-history"><Clock3 size={28} /><strong>No casts yet</strong><span>Your generated assets and recipes will appear here.</span></div>}
            {history.map((record, index) => (
              <button className="history-card" key={record.id} onClick={() => restoreCast(record)}>
                <span className={`history-thumb history-thumb--${record.assetType}`}><Box size={22} /></span>
                <span className="history-copy"><strong>{record.prompt || 'Untitled asset'}</strong><small>{STYLE_LABELS[record.style]} · {record.triangles / 1000}K tris</small></span>
                {index === 0 && <span className="new-dot" />}
              </button>
            ))}
          </div>
          <div className="system-card">
            <div><span className="status-light" /><strong>System ready</strong></div>
            <dl><dt>GPU</dt><dd>RTX 4070 Laptop · 8 GB</dd><dt>Engine</dt><dd>{realEngine.modelAvailable ? 'Hunyuan3D Mini' : 'Demo adapter'}</dd><dt>Queue</dt><dd>{running ? '1 active' : 'Idle'}</dd></dl>
          </div>
        </aside>
      </section>

      <footer><span>FORGECAST 0.1.0 · LOCAL-FIRST PROTOTYPE</span><span><Play size={11} fill="currentColor" /> Engine logs</span></footer>
    </main>
  )
}
