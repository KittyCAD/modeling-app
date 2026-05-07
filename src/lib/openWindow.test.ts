import { getExternalURLWithDocsFallback } from '@src/lib/openWindow'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('getExternalURLWithDocsFallback', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('falls back to production docs when the configured docs URL fails', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Failed to fetch'))

    await expect(
      getExternalURLWithDocsFallback('https://dev.zoo.dev/docs')
    ).resolves.toBe('https://zoo.dev/docs')
    expect(fetchMock).toHaveBeenCalledWith('https://dev.zoo.dev/docs', {
      method: 'HEAD',
    })
  })
})
