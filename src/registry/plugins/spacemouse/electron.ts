import { X509Certificate } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { app } from 'electron'
import type { ElectronPluginContext } from '@src/registry/pluginIpc'

// The macOS driver generates this certificate per installation. Pin to that
// local copy when its CA is missing from Chromium's trust store.
const MAC_DRIVER_CERTIFICATE =
  '/Applications/3Dconnexion/3DxNLServer/server.crt'

export function matchesInstalledDriverCertificate(
  url: string,
  servedPem: string,
  installedPem: string,
  now = Date.now()
) {
  try {
    const endpoint = new URL(url)
    if (
      endpoint.hostname !== '127.51.68.120' ||
      !['https:', 'wss:'].includes(endpoint.protocol)
    )
      return false
    const served = new X509Certificate(servedPem)
    const installed = new X509Certificate(installedPem)
    return (
      served.fingerprint256 === installed.fingerprint256 &&
      served.checkIP('127.51.68.120') !== undefined &&
      Date.parse(served.validFrom) <= now &&
      now <= Date.parse(served.validTo)
    )
  } catch {
    return false
  }
}

export function register({ isPluginEnabled }: ElectronPluginContext) {
  if (process.platform !== 'darwin') return
  app.on(
    'certificate-error',
    (event, _contents, url, _error, certificate, callback) => {
      if (
        !isPluginEnabled('spacemouse') ||
        new URL(url).hostname !== '127.51.68.120'
      ) {
        callback(false)
        return
      }
      event.preventDefault()
      readFile(MAC_DRIVER_CERTIFICATE, 'utf8')
        .then((installedPem) =>
          callback(
            matchesInstalledDriverCertificate(
              url,
              certificate.data,
              installedPem
            )
          )
        )
        .catch(() => callback(false))
    }
  )
}
