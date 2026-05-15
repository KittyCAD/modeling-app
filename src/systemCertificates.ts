import tls from 'node:tls'

let configured = false

type TlsWithSystemCertificates = typeof tls & {
  getCACertificates?: (type: 'default' | 'system') => string[]
  setDefaultCACertificates?: (certificates: readonly string[]) => void
}

export const shouldUseSystemCertificates = (
  platform: NodeJS.Platform = process.platform
): boolean => {
  return platform === 'win32' || platform === 'darwin'
}

const patchCreateSecureContextWithSystemCerts = (
  systemCerts: readonly string[]
) => {
  const originalCreateSecureContext = tls.createSecureContext
  tls.createSecureContext = ((options?: tls.SecureContextOptions) => {
    const context = originalCreateSecureContext(options)
    if (!options?.ca) {
      const contextWithCa = context as {
        context?: { addCACert?: (cert: string) => void }
      }
      const addCACert = contextWithCa.context?.addCACert
      if (typeof addCACert === 'function') {
        for (const cert of systemCerts) {
          addCACert.call(contextWithCa.context, cert)
        }
      }
    }
    return context
  }) as typeof tls.createSecureContext
}

export const configureSystemCertificates = (
  platform: NodeJS.Platform = process.platform
): void => {
  if (!shouldUseSystemCertificates(platform)) {
    return
  }

  if (configured) {
    return
  }

  const tlsWithSystemCertificates = tls as TlsWithSystemCertificates
  const getCACertificates = tlsWithSystemCertificates.getCACertificates?.bind(
    tlsWithSystemCertificates
  )
  if (typeof getCACertificates !== 'function') {
    return
  }

  const systemCerts = getCACertificates('system')
  if (systemCerts.length === 0) {
    return
  }

  if (
    typeof tlsWithSystemCertificates.setDefaultCACertificates === 'function'
  ) {
    const defaultCerts = getCACertificates('default')
    tlsWithSystemCertificates.setDefaultCACertificates(
      Array.from(new Set([...defaultCerts, ...systemCerts]))
    )
    configured = true
    return
  }

  patchCreateSecureContextWithSystemCerts(systemCerts)
  configured = true
}
