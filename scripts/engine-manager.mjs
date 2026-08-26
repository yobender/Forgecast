import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = join(projectRoot, '.runtime')
const logsRoot = join(runtimeRoot, 'logs')
const statePath = join(runtimeRoot, 'active-engine.json')
const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const port = 8764

mkdirSync(logsRoot, { recursive: true })

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

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return sendJson(response, 204, {})
  if (request.method === 'GET' && request.url === '/health') return sendJson(response, 200, { status: 'healthy' })
  if (request.method === 'GET' && request.url === '/engines') return sendJson(response, 200, engineState())
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
