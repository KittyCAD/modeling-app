import tls from 'node:tls'

const getSystemCerts = (): string[] => {
  const tlsAny = tls as typeof tls & {
    getCACertificates: (type?: string) => string[]
  }
  return tlsAny.getCACertificates('system')
}

let patched = false

export const configureWindowsSystemCertificates = (): void => {
  if (process.platform !== 'win32') {
    return
  }

  if (patched) {
    return
  }

  const systemCerts = getSystemCerts()
  if (systemCerts.length === 0) {
    return
  }

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

  patched = true
}
