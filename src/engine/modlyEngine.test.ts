import { describe, expect, it } from 'vitest'
import { shouldUseMiniMultiView } from './modlyEngine'

describe('Hunyuan Mini reference routing', () => {
  it('always uses a single reference in laptop-safe mode', () => {
    expect(shouldUseMiniMultiView(4, 'full', 'laptop')).toBe(false)
    expect(shouldUseMiniMultiView(2, 'front-priority', 'laptop')).toBe(false)
  })

  it('allows exact-turntable fusion only as an explicit desktop option', () => {
    expect(shouldUseMiniMultiView(4, 'full', 'desktop')).toBe(true)
    expect(shouldUseMiniMultiView(1, 'full', 'desktop')).toBe(false)
    expect(shouldUseMiniMultiView(4, 'front-priority', 'desktop')).toBe(false)
  })
})
