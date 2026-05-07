import { getExternalURLWithDocsFallback } from '@src/lib/openWindow'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('getExternalURLWithDocsFallback', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the configured docs URL when it fetches successfully', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response())

    await expect(
      getExternalURLWithDocsFallback('https://dev.zoo.dev/docs')
    ).resolves.toBe('https://dev.zoo.dev/docs')
    expect(fetchMock).toHaveBeenCalledWith('https://dev.zoo.dev/docs', {
      method: 'HEAD',
      mode: 'no-cors',
    })
  })

  it('falls back to production docs when the configured docs URL fails to fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('Failed to fetch')
    )

    await expect(
      getExternalURLWithDocsFallback('https://dev.zoo.dev/docs')
    ).resolves.toBe('https://zoo.dev/docs')
  })

  it('does not fetch deeper docs URLs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(
      getExternalURLWithDocsFallback(
        'https://dev.zoo.dev/docs/kcl-lang?tab=all#types'
      )
    ).resolves.toBe('https://dev.zoo.dev/docs/kcl-lang?tab=all#types')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not fetch non-docs URLs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(
      getExternalURLWithDocsFallback('https://dev.zoo.dev/account')
    ).resolves.toBe('https://dev.zoo.dev/account')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
