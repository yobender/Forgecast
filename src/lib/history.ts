import type { CastRecord } from '../types'
import { normalizeGeometryPreset } from './presets'

const STORAGE_KEY = 'forgecast.history.v1'

export function loadHistory(): CastRecord[] {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    if (!value) return []
    return (JSON.parse(value) as CastRecord[]).map((record) => ({
      ...record,
      style: normalizeGeometryPreset(record.style),
    }))
  } catch {
    return []
  }
}

export function saveHistory(history: CastRecord[]) {
  const recent = history.slice(0, 60)
  const protectedMasters = history.filter((record) => record.workflowRole === 'master' && !recent.some((item) => item.id === record.id))
  const retained = new Map([...recent, ...protectedMasters].map((record) => [record.id, record]))
  const all = new Map(history.map((record) => [record.id, record]))
  for (const record of retained.values()) {
    const source = record.sourceRecordId && all.get(record.sourceRecordId)
    if (source && !retained.has(source.id)) retained.set(source.id, source)
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...retained.values()]))
}
