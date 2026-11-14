import {
  expiredSystemCertificate,
  validSystemCertificate,
} from '@src/systemCertificates.fixtures'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    // Keep time between the fixture expiry dates so tests do not age out.
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-01T00:00:00Z'))
    getCACertificates.mockImplementation((type: 'default' | 'system') => {
      return type === 'default'
        ? ['public-root']
        : [expiredSystemCertificate, validSystemCertificate]
    })
  })

  afterEach(async () => {
    const tlsModule = (await import('node:tls')).default
    tlsModule.createSecureContext = createSecureContext
    vi.restoreAllMocks()
  })

  it('loads only unexpired system certificates into Node TLS on macOS', async () => {
    const { configureSystemCertificates } = await import(
      '@src/systemCertificates'
    )

    configureSystemCertificates('darwin')

    expect(getCACertificates).toHaveBeenNthCalledWith(1, 'system')
    expect(getCACertificates).toHaveBeenNthCalledWith(2, 'default')
    expect(setDefaultCACertificates).toHaveBeenCalledWith([
      'public-root',
      validSystemCertificate,
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
    const tlsModule = (await import('node:tls')).default

    const { configureSystemCertificates } = await import(
      '@src/systemCertificates'
    )

    configureSystemCertificates('win32')

    tlsModule.createSecureContext()
    expect(addCACert).toHaveBeenCalledExactlyOnceWith(validSystemCertificate)

    addCACert.mockClear()
    tlsModule.createSecureContext({
      ca: 'custom-ca',
    })
    expect(addCACert).not.toHaveBeenCalled()
  })
})
