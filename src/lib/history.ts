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
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 20)))
}
