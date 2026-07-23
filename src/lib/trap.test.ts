import { formatRejectionReason, reportRejection } from '@src/lib/trap'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('reportRejection', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports Error messages instead of stringifying them as empty objects', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    reportRejection(new Error('Personal Cloud already has a local copy.'))

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Personal Cloud already has a local copy.')
    )
  })
})

describe('formatRejectionReason', () => {
  it('serializes non-error objects when possible', () => {
    expect(formatRejectionReason({ reason: 'blocked' })).toBe(`{
  "reason": "blocked"
}`)
  })
})
