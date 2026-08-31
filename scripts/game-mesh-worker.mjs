import { parentPort, workerData } from 'node:worker_threads'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { processGameMesh } from './lib/game-mesh.mjs'

try {
  const source = readFileSync(workerData.inputPath)
  const result = await processGameMesh(source, workerData.options, (message) => parentPort.postMessage({ status: 'running', message }))
  const sourceHash = createHash('sha256').update(source).digest('hex')
  writeFileSync(workerData.outputPath, result.bytes, { flag: 'wx' })
  parentPort.postMessage({ status: 'done', stats: { ...result.stats, sourceHash } })
} catch (error) {
  parentPort.postMessage({ status: 'error', error: error instanceof Error ? error.message : String(error) })
}
