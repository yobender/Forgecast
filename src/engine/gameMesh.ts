import type { GameMeshStats, GameProtection } from '../types'

const BASE = 'http://127.0.0.1:8764'
export function retainedFilename(url: string) {
  const source = new URL(url)
  if (source.origin !== BASE || !/^\/library\/models\/[a-f0-9-]+\.glb$/i.test(source.pathname) || source.search || source.hash) throw new Error('Select a model saved in the local library first.')
  return source.pathname.split('/').at(-1)!
}

export async function createMeshCopy(sourceUrl: string, options: { operation: 'optimize' | 'color'; targetTriangles?: number; protection?: GameProtection; legacyMiniColor: boolean }, onProgress: (message: string) => void) {
  const response = await fetch(`${BASE}/game-jobs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: retainedFilename(sourceUrl), ...options }),
  })
  if (response.status === 404) throw new Error('Restart Forgecast to load the new game-mesh service, then reopen this saved model. No regeneration is needed.')
  const submitted = await response.json() as { id?: string; error?: string }
  if (!response.ok || !submitted.id) throw new Error(submitted.error || 'Could not start mesh processing')
  const deadline = Date.now() + 11 * 60 * 1000
  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 750))
    const polled = await fetch(`${BASE}/game-jobs/${submitted.id}`, { signal: AbortSignal.timeout(15000) })
    const job = await polled.json() as { status: string; message?: string; error?: string; url?: string; stats?: GameMeshStats }
    if (!polled.ok || job.status === 'error') throw new Error(job.error || 'Mesh processing failed')
    if (job.message) onProgress(job.message)
    if (job.status === 'done' && job.url && job.stats) return { modelUrl: `${BASE}${job.url}`, stats: job.stats }
  }
  throw new Error('Mesh worker did not respond in time; the saved source is unchanged.')
}
