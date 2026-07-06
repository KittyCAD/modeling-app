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

  it('returns allowed non-docs URLs without probing them', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(
      getExternalURLWithDocsFallback('http://localhost:3000/settings')
    ).resolves.toBe('http://localhost:3000/settings')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects non-web external URL schemes', async () => {
    await expect(
      getExternalURLWithDocsFallback('file:///Applications/Calculator.app')
    ).rejects.toThrow('External URL protocol is not allowed: file:')
    await expect(
      getExternalURLWithDocsFallback('vscode://file/tmp/project')
    ).rejects.toThrow('External URL protocol is not allowed: vscode:')
    await expect(getExternalURLWithDocsFallback('not a url')).rejects.toThrow(
      'External URL must be absolute'
    )
  })
})
