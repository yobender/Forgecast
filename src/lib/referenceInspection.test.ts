import { describe, expect, it } from 'vitest'
import { referenceWarnings } from './referenceInspection'

describe('referenceWarnings', () => {
  it('accepts a useful square reference', () => {
    expect(referenceWarnings({ width: 1024, height: 1024, bytes: 400_000 })).toEqual([])
  })

  it('flags low-resolution, extreme, highly compressed references', () => {
    const warnings = referenceWarnings({ width: 240, height: 1200, bytes: 30_000 })
    expect(warnings).toHaveLength(3)
    expect(warnings.join(' ')).toContain('512 px')
  })
})
