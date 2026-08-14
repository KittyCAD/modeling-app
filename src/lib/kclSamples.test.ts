import { downloadKclSample } from '@src/lib/kclSamples'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('KCL samples', () => {
  it('downloads current samples for project creation', async () => {
    const code = '// Angle Gauge\n'
    const fetchMock = vi.fn(async () => new Response(code))
    vi.stubGlobal('fetch', fetchMock)

    const downloadedSample = await downloadKclSample('angle-gauge/main.kcl')

    expect(fetchMock).toHaveBeenCalledWith('/kcl-samples/angle-gauge/main.kcl')
    expect(downloadedSample.sample.title).toBe('Angle Gauge')
    expect(downloadedSample.requestedProjectName).toBe('angle-gauge')
    expect(downloadedSample.initialProject.entrypointFilePath).toBe('main.kcl')
    expect(downloadedSample.initialProject.files).toEqual([
      {
        requestedFileName: 'main.kcl',
        requestedData: new TextEncoder().encode(code),
      },
    ])
  })

  it('supports the relative asset URLs used by desktop', async () => {
    const fetchMock = vi.fn(async () => new Response('// Angle Gauge\n'))
    vi.stubGlobal('fetch', fetchMock)

    await downloadKclSample('angle-gauge/main.kcl', { assetUrlPrefix: '.' })

    expect(fetchMock).toHaveBeenCalledWith('./kcl-samples/angle-gauge/main.kcl')
  })

  it('rejects samples missing from the current catalog', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      downloadKclSample('telemetry-antenna/main.kcl')
    ).rejects.toThrow("Couldn't find KCL sample.")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
