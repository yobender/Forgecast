import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = join(projectRoot, '.runtime')
const logsRoot = join(runtimeRoot, 'logs')
const printExportsRoot = join(runtimeRoot, 'print-exports')
const statePath = join(runtimeRoot, 'active-engine.json')
const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const port = 8764

mkdirSync(logsRoot, { recursive: true })
mkdirSync(printExportsRoot, { recursive: true })

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
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
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
  const allowedPorts = new Set(['8765', '8081', '8766'])
  if (sourceUrl.protocol !== 'http:' || sourceUrl.hostname !== '127.0.0.1' || !allowedPorts.has(sourceUrl.port)) {
    throw new Error('Print refinement only accepts output from a local Forgecast engine')
  }
  const heightMm = Math.max(10, Math.min(500, Number(body.heightMm) || 75))
  const profile = body.profile === 'balanced' ? 'balanced' : 'fine'
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
    const { stdout } = await runProcess(python, [script, '--input', inputPath, '--output', outputPath, '--height-mm', String(heightMm), '--profile', profile])
    const statsLine = stdout.split(/\r?\n/).reverse().find((line) => line.trim().startsWith('{'))
    const stats = statsLine ? JSON.parse(statsLine) : { heightMm, profile }
    return { url: `/exports/${outputName}`, stats }
  } finally {
    try { unlinkSync(inputPath) } catch { /* Temporary input may already be gone. */ }
  }
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return sendJson(response, 204, {})
  if (request.method === 'GET' && request.url === '/health') return sendJson(response, 200, { status: 'healthy' })
  if (request.method === 'GET' && request.url === '/engines') return sendJson(response, 200, engineState())
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
  if (preferred) activation = activation.catch(() => undefined).then(() => startWorker(preferred)).catch((error) => console.error(error))
})

const shutdown = () => {
  server.close()
  void stopWorker().finally(() => process.exit(0))
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
