import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WorkshopTray, type WorkshopCandidate } from './WorkshopTray'

const candidates: WorkshopCandidate[] = [1, 2, 3].map((index) => ({
  recordId: `cast-${index}`, index, seed: 483921 + (index - 1) * 104729,
  modelUrl: `/candidate-${index}.glb`, engine: 'Mini', triangles: 60000,
  modelBytes: 20 * 1024 ** 2, thumbnail: '/test-thumbnail.jpg',
}))

const render = (viewedId: string | null, masterId?: string) => renderToStaticMarkup(createElement(WorkshopTray, {
  candidates, viewedId, masterId, onSelect: () => undefined, onApprove: () => undefined,
}))

describe('WorkshopTray', () => {
  it('starts expanded for selection and explains alternatives honestly', () => {
    const html = render('cast-2')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('not successive detail upgrades')
    expect(html).toContain('Viewing Candidate 2')
    expect(html).toContain('Keep Candidate 2 as master')
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(html.match(/Click to inspect/g)).toHaveLength(2)
  })

  it('starts collapsed for a saved master and keeps its identity while viewing another version', () => {
    const html = render('cast-2', 'cast-1')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('hidden=""')
    expect(html).toContain('Viewing Candidate 2 · Master: Candidate 1')
    expect(html).toContain('View master')
    expect(html).not.toContain('Keep Candidate 2 as master')
  })

  it('does not offer a redundant return action when already viewing the master', () => {
    expect(render('cast-1', 'cast-1')).not.toContain('View master')
  })

  it('does not permit approving an unrelated library asset', () => {
    const html = render(null)
    expect(html).toContain('Viewing another library asset')
    expect(html).toContain('disabled=""')
    expect(html).toContain('Select a candidate')
    expect(html).not.toContain('aria-pressed="true"')
  })
})
