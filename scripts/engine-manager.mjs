import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { validateGameOptions } from './lib/game-mesh.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = join(projectRoot, '.runtime')
const logsRoot = join(runtimeRoot, 'logs')
const printExportsRoot = join(runtimeRoot, 'print-exports')
const libraryModelsRoot = join(runtimeRoot, 'library', 'models')
const statePath = join(runtimeRoot, 'active-engine.json')
const geometryPresets = new Set(['miniature-sculpt', 'hard-surface', 'organic', 'low-poly', 'print-safe'])
const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const port = Number(process.env.FORGECAST_MANAGER_PORT) || 8764
const meshJobs = new Map()
let activeMeshWorker

mkdirSync(logsRoot, { recursive: true })
mkdirSync(printExportsRoot, { recursive: true })
mkdirSync(libraryModelsRoot, { recursive: true })

const detectHardware = () => {
  try {
    const line = execFileSync('nvidia-smi.exe', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    }).trim().split(/\r?\n/)[0]
    const separator = line.lastIndexOf(',')
    const gpuName = line.slice(0, separator).trim()
    const vramMb = Number.parseInt(line.slice(separator + 1).trim(), 10)
    return { gpuName, vramMb, profile: vramMb >= 12288 ? 'desktop' : 'laptop' }
  } catch {
    return { profile: 'laptop' }
  }
}

const hardware = detectHardware()

const engines = {
  'hunyuan-mini': {
    name: 'Hunyuan3D 2 Mini',
    script: join(projectRoot, 'scripts', 'start-real-engine.ps1'),
    installed: () => existsSync(join(runtimeRoot, 'modly', 'api', '.venv', 'Scripts', 'python.exe')),
  },
  'hunyuan-2.1': {
    name: 'Hunyuan3D 2.1',
    script: join(projectRoot, 'scripts', 'start-hunyuan21.ps1'),
    installed: () => existsSync(join(runtimeRoot, 'venvs', 'hunyuan3d-2.1', 'Scripts', 'python.exe')),
  },
  'trellis-2': {
    name: 'TRELLIS.2 4B',
    script: join(projectRoot, 'scripts', 'start-trellis2.ps1'),
    stopScript: join(projectRoot, 'scripts', 'stop-trellis2.ps1'),
    installed: () => existsSync(join(runtimeRoot, 'trellis2.json')),
  },
}

let activeEngine
let worker
let activation = Promise.resolve()

const sendJson = (response, status, value) => {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  })
  response.end(JSON.stringify(value))
}

const stopWorker = async () => {
  if (!worker || worker.exitCode !== null) {
    worker = undefined
    return
  }
  const pid = worker.pid
  const stopScript = engines[activeEngine]?.stopScript
  if (stopScript && existsSync(stopScript)) {
    await new Promise((resolveStop) => {
      const stopper = spawn(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', stopScript], { windowsHide: true, stdio: 'ignore' })
      stopper.once('exit', resolveStop)
      stopper.once('error', resolveStop)
    })
  }
  await new Promise((resolveStop) => {
    const killer = spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
    killer.once('exit', resolveStop)
    killer.once('error', resolveStop)
  })
  worker = undefined
}

const startWorker = async (engineId) => {
  const definition = engines[engineId]
  if (!definition) throw new Error(`Unknown engine: ${engineId}`)
  if (!definition.installed()) throw new Error(`${definition.name} is not installed`)
  if (activeEngine === engineId && worker && worker.exitCode === null) return

  await stopWorker()
  activeEngine = engineId
  writeFileSync(statePath, JSON.stringify({ engineId }, null, 2))
  const log = createWriteStream(join(logsRoot, `${engineId}.log`), { flags: 'a' })
  log.write(`\n[${new Date().toISOString()}] Starting ${definition.name}\n`)
  worker = spawn(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', definition.script], {
    cwd: projectRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  worker.stdout.pipe(log, { end: false })
  worker.stderr.pipe(log, { end: false })
  worker.once('exit', (code) => {
    log.write(`[${new Date().toISOString()}] Worker exited with code ${code}\n`)
    log.end()
  })
}

const engineState = () => ({
  activeEngine,
  workerRunning: Boolean(worker && worker.exitCode === null),
  hardware,
  engines: Object.fromEntries(Object.entries(engines).map(([id, engine]) => [id, {
    name: engine.name,
    installed: engine.installed(),
    active: id === activeEngine,
  }])),
})

const readBody = (request) => new Promise((resolveBody, rejectBody) => {
  const chunks = []
  let size = 0
  request.on('data', (chunk) => {
    size += chunk.length
    if (size > 64 * 1024) {
      rejectBody(new Error('Request body too large'))
      request.destroy()
      return
    }
    chunks.push(chunk)
  })
  request.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
  request.on('error', rejectBody)
})

const runProcess = (executable, args, timeoutMs = 5 * 60 * 1000) => new Promise((resolveRun, rejectRun) => {
  const child = spawn(executable, args, { cwd: projectRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); if (stdout.length > 128_000) stdout = stdout.slice(-128_000) })
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); if (stderr.length > 128_000) stderr = stderr.slice(-128_000) })
  const timeout = setTimeout(() => {
    child.kill()
    rejectRun(new Error('STL refinement timed out after five minutes'))
  }, timeoutMs)
  child.once('error', (error) => { clearTimeout(timeout); rejectRun(error) })
  child.once('exit', (code) => {
    clearTimeout(timeout)
    if (code === 0) resolveRun({ stdout, stderr })
    else rejectRun(new Error((stderr || stdout || `Print refiner exited with code ${code}`).trim()))
  })
})

const purgeOldPrintExports = () => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  for (const filename of readdirSync(printExportsRoot)) {
    if (!/^[a-f0-9-]+\.stl$/i.test(filename)) continue
    const outputPath = join(printExportsRoot, filename)
    if (statSync(outputPath).mtimeMs < cutoff) unlinkSync(outputPath)
  }
}

const refinePrintStl = async (body) => {
  purgeOldPrintExports()
  const sourceUrl = new URL(String(body.sourceUrl || ''))
  const engineSource = ['8765', '8081', '8766'].includes(sourceUrl.port)
  const librarySource = sourceUrl.port === String(port) && /^\/library\/models\/[a-f0-9-]+\.glb$/i.test(sourceUrl.pathname)
  if (sourceUrl.protocol !== 'http:' || sourceUrl.hostname !== '127.0.0.1' || (!engineSource && !librarySource)) {
    throw new Error('Print refinement only accepts output from a local Forgecast engine')
  }
  const heightMm = Math.max(10, Math.min(500, Number(body.heightMm) || 75))
  const profile = body.profile === 'balanced' ? 'balanced' : 'fine'
  const geometryPreset = geometryPresets.has(body.geometryPreset) ? body.geometryPreset : 'miniature-sculpt'
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`Could not read generated mesh: ${response.status} ${response.statusText}`)
  const declaredSize = Number(response.headers.get('content-length') || 0)
  if (declaredSize > 200 * 1024 * 1024) throw new Error('Generated mesh is larger than the 200 MB refinement limit')
  const meshBytes = Buffer.from(await response.arrayBuffer())
  if (meshBytes.length > 200 * 1024 * 1024) throw new Error('Generated mesh is larger than the 200 MB refinement limit')

  const jobId = randomUUID()
  const inputPath = join(printExportsRoot, `${jobId}.glb`)
  const outputName = `${jobId}.stl`
  const outputPath = join(printExportsRoot, outputName)
  const python = join(runtimeRoot, 'modly', 'api', '.venv', 'Scripts', 'python.exe')
  const script = join(projectRoot, 'backend', 'print_refine.py')
  if (!existsSync(python) || !existsSync(script)) throw new Error('Print refinement dependencies are not installed')
  writeFileSync(inputPath, meshBytes)
  try {
    const { stdout } = await runProcess(python, [script, '--input', inputPath, '--output', outputPath, '--height-mm', String(heightMm), '--profile', profile, '--geometry-preset', geometryPreset])
    const statsLine = stdout.split(/\r?\n/).reverse().find((line) => line.trim().startsWith('{'))
    const stats = statsLine ? JSON.parse(statsLine) : { heightMm, profile }
    return { url: `/exports/${outputName}`, stats }
  } finally {
    try { unlinkSync(inputPath) } catch { /* Temporary input may already be gone. */ }
  }
}

const retainLibraryModel = async (body) => {
  const sourceUrl = new URL(String(body.sourceUrl || ''))
  if (sourceUrl.protocol !== 'http:' || sourceUrl.hostname !== '127.0.0.1' || !['8765', '8081', '8766'].includes(sourceUrl.port)) {
    throw new Error('The library only retains output from a local Forgecast engine')
  }
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(90_000) })
  if (!response.ok) throw new Error(`Could not read generated mesh: ${response.status} ${response.statusText}`)
  const declaredSize = Number(response.headers.get('content-length') || 0)
  if (declaredSize > 300 * 1024 * 1024) throw new Error('Generated mesh is larger than the 300 MB library limit')
  const meshBytes = Buffer.from(await response.arrayBuffer())
  if (meshBytes.length > 300 * 1024 * 1024) throw new Error('Generated mesh is larger than the 300 MB library limit')
  const modelId = randomUUID()
  const filename = `${modelId}.glb`
  writeFileSync(join(libraryModelsRoot, filename), meshBytes)
  return { id: modelId, url: `/library/models/${filename}`, bytes: meshBytes.length }
}

const inspectLibraryModel = async (filename) => {
  const modelPath = join(libraryModelsRoot, filename)
  if (!existsSync(modelPath)) throw new Error('Library model not found')
  const cachePath = `${modelPath}.stats.json`
  if (existsSync(cachePath) && statSync(cachePath).mtimeMs >= statSync(modelPath).mtimeMs) {
    return JSON.parse(readFileSync(cachePath, 'utf8'))
  }
  const pythonCandidates = [
    join(runtimeRoot, 'forgecast-engine', 'extensions', 'hunyuan3d-mini', 'venv', 'Scripts', 'python.exe'),
    join(runtimeRoot, 'modly', 'api', '.venv', 'Scripts', 'python.exe'),
    join(runtimeRoot, 'venvs', 'hunyuan3d-2.1', 'Scripts', 'python.exe'),
  ]
  const python = pythonCandidates.find((candidate) => existsSync(candidate))
  const script = join(projectRoot, 'backend', 'mesh_inspect.py')
  if (!python || !existsSync(script)) throw new Error('Mesh inspection dependencies are not installed')
  const { stdout } = await runProcess(python, [script, '--input', modelPath], 60_000)
  const statsLine = stdout.split(/\r?\n/).reverse().find((line) => line.trim().startsWith('{'))
  if (!statsLine) throw new Error('Mesh inspector returned no statistics')
  const stats = JSON.parse(statsLine)
  writeFileSync(cachePath, JSON.stringify(stats, null, 2))
  return stats
}

const recoverLegacyModels = (body) => {
  const casts = Array.isArray(body.casts) ? body.casts.slice(0, 50) : []
  const outputRoots = [
    join(runtimeRoot, 'forgecast-engine', 'workspace', 'Forgecast'),
    join(runtimeRoot, 'forgecast-engine', 'hunyuan3d-2.1', 'outputs'),
  ]
  const candidates = outputRoots.flatMap((root) => {
    if (!existsSync(root)) return []
    return readdirSync(root)
      .filter((filename) => /^[a-z0-9_-]+\.glb$/i.test(filename))
      .map((filename) => {
        const path = join(root, filename)
        return { path, modifiedAt: statSync(path).mtimeMs }
      })
  })
  const used = new Set()
  const recovered = []
  for (const cast of casts) {
    if (typeof cast?.id !== 'string' || !/^[a-f0-9-]{8,}$/i.test(cast.id)) continue
    const createdAt = Date.parse(String(cast.createdAt || ''))
    if (!Number.isFinite(createdAt)) continue
    const match = candidates
      .filter((candidate) => !used.has(candidate.path))
      .map((candidate) => ({ ...candidate, difference: Math.abs(candidate.modifiedAt - createdAt) }))
      .filter((candidate) => candidate.difference <= 15 * 60 * 1000)
      .sort((a, b) => a.difference - b.difference)[0]
    if (!match) continue
    used.add(match.path)
    const modelId = randomUUID()
    const filename = `${modelId}.glb`
    copyFileSync(match.path, join(libraryModelsRoot, filename))
    recovered.push({ castId: cast.id, url: `/library/models/${filename}` })
  }
  return { recovered }
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return sendJson(response, 204, {})
  if (request.method === 'GET' && request.url === '/health') return sendJson(response, 200, { status: 'healthy' })
  if (request.method === 'GET' && request.url === '/engines') return sendJson(response, 200, engineState())
  if (request.method === 'POST' && request.url === '/game-jobs') {
    if (activeMeshWorker) return sendJson(response, 409, { error: 'Another mesh operation is running. Wait for it to finish.' })
    try {
      const body = JSON.parse(await readBody(request))
      const options = { operation: body.operation, targetTriangles: body.targetTriangles, protection: body.protection, legacyMiniColor: body.legacyMiniColor }
      validateGameOptions(options)
      if (typeof body.filename !== 'string' || !/^[a-f0-9-]+\.glb$/i.test(body.filename)) throw new Error('Choose a retained library model')
      const inputPath = join(libraryModelsRoot, body.filename)
      if (!existsSync(inputPath) || statSync(inputPath).size > 300 * 1024 * 1024) throw new Error('Source missing or exceeds the 300 MB mesh limit')
      // Recheck after reading the asynchronous body so two requests cannot start together.
      if (activeMeshWorker) return sendJson(response, 409, { error: 'Another mesh operation is running' })
      const id = randomUUID(), filename = `${randomUUID()}.glb`
      const job = { id, status: 'running', message: 'Preparing game mesh', url: `/library/models/${filename}` }
      meshJobs.set(id, job)
      while (meshJobs.size > 24) meshJobs.delete(meshJobs.keys().next().value)
      const meshWorker = new Worker(join(projectRoot, 'scripts', 'game-mesh-worker.mjs'), { workerData: { inputPath, outputPath: join(libraryModelsRoot, filename), options } })
      activeMeshWorker = meshWorker
      const timeout = setTimeout(() => { Object.assign(job, { status: 'error', error: 'Mesh operation exceeded ten minutes; original source is unchanged.' }); void meshWorker.terminate() }, 10 * 60 * 1000)
      meshWorker.on('message', (message) => { Object.assign(job, message); if (message.status !== 'running') clearTimeout(timeout) })
      meshWorker.once('error', (error) => { Object.assign(job, { status: 'error', error: error.message }) })
      meshWorker.once('exit', () => { clearTimeout(timeout); if (job.status === 'running') Object.assign(job, { status: 'error', error: 'Mesh worker exited before completion' }); if (activeMeshWorker === meshWorker) activeMeshWorker = undefined })
      return sendJson(response, 202, { id })
    } catch (error) { return sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }) }
  }
  if (request.method === 'GET' && request.url?.startsWith('/game-jobs/')) {
    const job = meshJobs.get(request.url.slice('/game-jobs/'.length))
    return sendJson(response, job ? 200 : 404, job || { error: 'Mesh job not found' })
  }
  if (request.method === 'GET' && request.url?.startsWith('/exports/')) {
    const outputName = request.url.slice('/exports/'.length)
    if (!/^[a-f0-9-]+\.stl$/i.test(outputName)) return sendJson(response, 400, { error: 'Invalid export name' })
    const outputPath = join(printExportsRoot, outputName)
    if (!existsSync(outputPath)) return sendJson(response, 404, { error: 'Export not found' })
    response.writeHead(200, {
      'Content-Type': 'model/stl',
      'Content-Disposition': `attachment; filename="forgecast-refined.stl"`,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    })
    return createReadStream(outputPath).pipe(response)
  }
  if (request.method === 'GET' && request.url?.startsWith('/library/models/')) {
    const statsMatch = request.url.match(/^\/library\/models\/([a-f0-9-]+\.glb)\/stats$/i)
    if (statsMatch) {
      try {
        return sendJson(response, 200, await inspectLibraryModel(statsMatch[1]))
      } catch (error) {
        return sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    }
    const filename = request.url.slice('/library/models/'.length)
    if (!/^[a-f0-9-]+\.glb$/i.test(filename)) return sendJson(response, 400, { error: 'Invalid library model name' })
    const modelPath = join(libraryModelsRoot, filename)
    if (!existsSync(modelPath)) return sendJson(response, 404, { error: 'Library model not found' })
    response.writeHead(200, {
      'Content-Type': 'model/gltf-binary',
      'Content-Length': statSync(modelPath).size,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
    return createReadStream(modelPath).pipe(response)
  }
  if (request.method === 'DELETE' && request.url?.startsWith('/library/models/')) {
    const filename = request.url.slice('/library/models/'.length)
    if (!/^[a-f0-9-]+\.glb$/i.test(filename)) return sendJson(response, 400, { error: 'Invalid library model name' })
    const modelPath = join(libraryModelsRoot, filename)
    if (existsSync(modelPath)) unlinkSync(modelPath)
    if (existsSync(`${modelPath}.stats.json`)) unlinkSync(`${modelPath}.stats.json`)
    return sendJson(response, 200, { deleted: true })
  }
  if (request.method === 'POST' && request.url === '/library/models') {
    try {
      return sendJson(response, 201, await retainLibraryModel(JSON.parse(await readBody(request))))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return sendJson(response, 500, { error: message.length > 1000 ? `${message.slice(0, 997)}…` : message })
    }
  }
  if (request.method === 'POST' && request.url === '/library/recover') {
    try {
      return sendJson(response, 200, recoverLegacyModels(JSON.parse(await readBody(request))))
    } catch (error) {
      return sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
  if (request.method === 'POST' && request.url === '/refine-stl') {
    try {
      const result = await refinePrintStl(JSON.parse(await readBody(request)))
      return sendJson(response, 200, result)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return sendJson(response, 500, { error: message.length > 1000 ? `${message.slice(0, 997)}…` : message })
    }
  }
  if (request.method === 'POST' && request.url === '/deactivate') {
    try {
      activation = activation.catch(() => undefined).then(() => stopWorker())
      await activation
      activeEngine = undefined
      return sendJson(response, 200, engineState())
    } catch (error) {
      return sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
  if (request.method === 'POST' && request.url === '/activate') {
    try {
      const body = JSON.parse(await readBody(request))
      if (!Object.hasOwn(engines, body.engineId)) return sendJson(response, 400, { error: 'Unknown engine' })
      if (!engines[body.engineId].installed()) return sendJson(response, 409, { error: `${engines[body.engineId].name} is not installed` })
      activation = activation.catch(() => undefined).then(() => startWorker(body.engineId))
      await activation
      return sendJson(response, 202, engineState())
    } catch (error) {
      return sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
  return sendJson(response, 404, { error: 'Not found' })
})

const installedIds = Object.keys(engines).filter((id) => engines[id].installed())
let preferred = installedIds[0]
try {
  const saved = JSON.parse(readFileSync(statePath, 'utf8')).engineId
  if (engines[saved]?.installed()) preferred = saved
} catch {
  // First launch has no saved engine.
}

server.listen(port, '127.0.0.1', () => {
  console.log(`[Forgecast] Engine manager listening on http://127.0.0.1:${port}`)
  if (preferred && process.env.FORGECAST_NO_ENGINE_AUTOSTART !== '1') activation = activation.catch(() => undefined).then(() => startWorker(preferred)).catch((error) => console.error(error))
})

const shutdown = () => {
  server.close()
  void activeMeshWorker?.terminate()
  void stopWorker().finally(() => process.exit(0))
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
