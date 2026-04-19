import { beforeEach, describe, expect, it, vi } from 'vitest'

const tlsMockState = vi.hoisted(() => ({
  useSetDefaultCACertificates: true,
}))

const addCACert = vi.fn()
const createSecureContext = vi.fn(() => ({
  context: { addCACert },
}))
const getCACertificates = vi.fn()
const setDefaultCACertificates = vi.fn()

vi.mock('node:tls', () => ({
  default: {
    createSecureContext,
    getCACertificates,
    get setDefaultCACertificates() {
      return tlsMockState.useSetDefaultCACertificates
        ? setDefaultCACertificates
        : undefined
    },
  },
}))

describe('systemCertificates', () => {
  beforeEach(() => {
    vi.resetModules()
    tlsMockState.useSetDefaultCACertificates = true
    createSecureContext.mockClear()
    getCACertificates.mockReset()
    setDefaultCACertificates.mockReset()
    addCACert.mockReset()
  })

  it('loads system certificates into Node TLS on macOS', async () => {
    getCACertificates.mockImplementation((type: 'default' | 'system') => {
      return type === 'default' ? ['public-root'] : ['cert-a', 'cert-b']
    })

    const { configureSystemCertificates } = await import(
      '@src/systemCertificates'
    )

    configureSystemCertificates('darwin')

    expect(getCACertificates).toHaveBeenNthCalledWith(1, 'system')
    expect(getCACertificates).toHaveBeenNthCalledWith(2, 'default')
    expect(setDefaultCACertificates).toHaveBeenCalledWith([
      'public-root',
      'cert-a',
      'cert-b',
    ])
  })

  it('skips unsupported platforms', async () => {
    const { configureSystemCertificates } = await import(
      '@src/systemCertificates'
    )

    configureSystemCertificates('linux')

    expect(getCACertificates).not.toHaveBeenCalled()
    expect(setDefaultCACertificates).not.toHaveBeenCalled()
  })

  it('falls back to patching secure contexts when setDefaultCACertificates is unavailable', async () => {
    tlsMockState.useSetDefaultCACertificates = false
    getCACertificates.mockImplementation((type: 'default' | 'system') => {
      return type === 'default' ? ['public-root'] : ['cert-a', 'cert-b']
    })
    const tlsModule = (await import('node:tls')).default

    const { configureSystemCertificates } = await import(
      '@src/systemCertificates'
    )

    configureSystemCertificates('win32')

    tlsModule.createSecureContext()
    expect(addCACert).toHaveBeenNthCalledWith(1, 'cert-a')
    expect(addCACert).toHaveBeenNthCalledWith(2, 'cert-b')

    addCACert.mockClear()
    tlsModule.createSecureContext({
      ca: 'custom-ca',
    } as never)
    expect(addCACert).not.toHaveBeenCalled()
  })
})
