import { describe, expect, it } from 'vitest'
import { slugify } from './naming'

describe('slugify', () => {
  it('creates a portable export name', () => {
    expect(slugify('Copper Golem: Mk. II!')).toBe('copper-golem-mk-ii')
  })

  it('falls back when a prompt has no filename-safe characters', () => {
    expect(slugify('✨✨')).toBe('cast')
  })

  it('limits filenames to a manageable length', () => {
    expect(slugify('a'.repeat(100))).toHaveLength(38)
  })
})
