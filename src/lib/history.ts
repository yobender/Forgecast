import type { CastRecord } from '../types'

const STORAGE_KEY = 'forgecast.history.v1'

export function loadHistory(): CastRecord[] {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value ? (JSON.parse(value) as CastRecord[]) : []
  } catch {
    return []
  }
}

export function saveHistory(history: CastRecord[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 20)))
}
