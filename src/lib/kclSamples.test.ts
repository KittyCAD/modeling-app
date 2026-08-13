import { downloadKclSample, findKclSample } from '@src/lib/kclSamples'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('KCL samples', () => {
  it('keeps legacy samples out of the current sample catalog', () => {
    expect(findKclSample('angle-gauge/main.kcl')).toMatchObject({
      title: 'Angle Gauge',
    })
    expect(findKclSample('telemetry-antenna/main.kcl')).toBeUndefined()
  })

  it('downloads legacy samples used by old deep links', async () => {
    const code = '// Aircraft telemetry antenna plate\n'
    const fetchMock = vi.fn(async () => new Response(code))
    vi.stubGlobal('fetch', fetchMock)

    const downloadedSample = await downloadKclSample(
      'telemetry-antenna/main.kcl'
    )

    expect(fetchMock).toHaveBeenCalledWith(
      '/kcl-samples-legacy/telemetry-antenna/main.kcl'
    )
    expect(downloadedSample.sample.title).toBe(
      'Aircraft telemetry antenna plate'
    )
    expect(downloadedSample.requestedProjectName).toBe('telemetry-antenna')
    expect(downloadedSample.initialProject.entrypointFilePath).toBe('main.kcl')
    expect(downloadedSample.initialProject.files).toEqual([
      {
        requestedFileName: 'main.kcl',
        requestedData: new TextEncoder().encode(code),
      },
    ])
  })
})
