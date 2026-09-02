import { describe, expect, it } from 'vitest'
import { shouldUseMiniMultiView } from './modlyEngine'

describe('Hunyuan Mini reference routing', () => {
  it('uses every supplied shape view when full fusion is selected', () => {
    expect(shouldUseMiniMultiView(4, 'full', 'laptop')).toBe(true)
    expect(shouldUseMiniMultiView(4, 'full', 'desktop')).toBe(true)
  })

  it('keeps front-only generation explicit', () => {
    expect(shouldUseMiniMultiView(2, 'front-priority', 'laptop')).toBe(false)
    expect(shouldUseMiniMultiView(1, 'full', 'desktop')).toBe(false)
    expect(shouldUseMiniMultiView(4, 'front-priority', 'desktop')).toBe(false)
  })
})
