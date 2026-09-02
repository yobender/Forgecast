import { expect, it } from 'vitest'
import { retainedFilename } from './gameMesh'

it('restricts processing to retained local models', () => {
  expect(retainedFilename('http://127.0.0.1:8764/library/models/abc-123.glb')).toBe('abc-123.glb')
  for (const url of ['https://other.test/abc.glb', 'http://127.0.0.1:8765/library/models/abc.glb', 'http://127.0.0.1:8764/library/models/abc.glb?other=1', 'file:///abc.glb']) expect(() => retainedFilename(url)).toThrow()
})
