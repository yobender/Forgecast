import { afterEach, expect, it, vi } from 'vitest'
import { loadHistory, saveHistory } from './history'
import type { CastRecord } from '../types'

afterEach(() => vi.unstubAllGlobals())
it('retains original sources and protected masters beyond the recent-history limit', () => {
  const data = new Map<string, string>()
  vi.stubGlobal('window', {localStorage: {setItem: (key: string, value: string) => data.set(key,value), getItem: (key: string) => data.get(key)}})
  const records = Array.from({length:70}, (_,i) => ({id:String(i),style:'hard-surface'} as CastRecord))
  records[0].sourceRecordId = '65'
  records[65].sourceRecordId = '66'
  records[69].workflowRole = 'master'
  saveHistory(records)
  const ids = loadHistory().map((record) => record.id)
  expect(ids).toContain('65')
  expect(ids).toContain('66')
  expect(ids).toContain('69')
  expect(ids).not.toContain('64')
})
