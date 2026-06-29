import fs from 'fs'
import { fileURLToPath } from 'node:url'
import os from 'os'
import path from 'path'
// @ts-ignore: TS1343
import * as packageJSON from '@root/package.json'
import { net, app, session } from 'electron'

import {
  STAGING_BUILD_SUFFIX,
  getAppFolderNameFromBuild,
} from '@src/lib/appFolderName'
import { ENVIRONMENT_FILE_NAME } from '@src/lib/constants'

const CSP_META_REGEX =
  /<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi
const CSP_SCRIPT_SRC =
  "script-src 'self' 'wasm-unsafe-eval' https://plausible.corp.zoo.dev/js/script.tagged-events.js"

const normalizeDomain = (value?: string) => {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  try {
    return new URL(trimmed).hostname
  } catch {
    return trimmed
  }
}

const uniqueSources = (sources: Array<string | undefined>) => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const source of sources) {
    if (!source || seen.has(source)) continue
    seen.add(source)
    result.push(source)
  }
  return result
}

const getEnvironmentFolderName = () => {
  return getAppFolderNameFromBuild({
    packageName: packageJSON.name,
    packageVersion: packageJSON.version,
    platform: os.platform(),
  })
}

const isStagingOrDebugBuild =
  packageJSON.name.includes(STAGING_BUILD_SUFFIX) ||
  packageJSON.version === '0.0.0' ||
  packageJSON.version === 'dev'

const getTestSettingsPathForCsp = () => {
  if (process.env.NODE_ENV !== 'test') return undefined
  // @ts-ignore app.testProperty is assigned at runtime.
  const testSettingsPath = app.testProperty?.TEST_SETTINGS_FILE_KEY
  if (typeof testSettingsPath !== 'string' || !testSettingsPath) {
    return undefined
  }
  return testSettingsPath
}

const getEnvironmentFilePathForCsp = async () => {
  const testSettingsPath = getTestSettingsPathForCsp()
  const appConfig = app.getPath('appData')
  const fullPath = testSettingsPath
    ? path.resolve(testSettingsPath, '..')
    : path.join(appConfig, getEnvironmentFolderName())
  try {
    await fs.promises.stat(fullPath)
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      await fs.promises.mkdir(fullPath, { recursive: true })
    }
  }
  return path.join(fullPath, ENVIRONMENT_FILE_NAME)
}

const readEnvironmentDomainForCsp = async () => {
  const fallbackDomain = normalizeDomain(process.env.VITE_ZOO_BASE_DOMAIN)
  try {
    const envPath = await getEnvironmentFilePathForCsp()
    if (!fs.existsSync(envPath)) {
      return fallbackDomain
    }
    const value = await fs.promises.readFile(envPath, 'utf8')
    return normalizeDomain(value) || fallbackDomain
  } catch (error) {
    console.error('Failed to read environment file for CSP', error)
    return fallbackDomain
  }
}

const buildCsp = (domain?: string) => {
  const connectSources = uniqueSources([
    "'self'",
    'https://plausible.corp.zoo.dev',
    'https://127.51.68.120:*',
    'wss://127.51.68.120:*',
    domain ? `https://api.${domain}` : undefined,
    domain ? `wss://api.${domain}` : undefined,
  ])

  return (
    [
      "default-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src * blob: data: 'unsafe-inline'",
      `connect-src ${connectSources.join(' ')}`,
      "object-src 'none'",
      CSP_SCRIPT_SRC,
    ].join('; ') + ';'
  )
}

const buildIndexHtmlWithCsp = async (indexPath: string) => {
  const domain = await readEnvironmentDomainForCsp()
  const csp = buildCsp(domain)
  const html = await fs.promises.readFile(indexPath, 'utf8')
  const metaTag = `<meta http-equiv="Content-Security-Policy" content="${csp}">`
  const withoutCsp = html.replace(CSP_META_REGEX, '')
  const updatedHtml = withoutCsp.replace(
    /<head[^>]*>/i,
    (match) => `${match}\n  ${metaTag}`
  )
  return Buffer.from(updatedHtml, 'utf8')
}

export const registerFileProtocolCsp = () => {
  if (isStagingOrDebugBuild) {
    return
  }

  session.defaultSession.protocol.handle('file', async (request) => {
    const filePath = fileURLToPath(request.url)

    // Only intercept index.html to inject CSP; pass everything else through.
    if (path.basename(filePath) !== 'index.html') {
      // Pass through the original request to preserve headers like Range for media.
      return await net.fetch(request, {
        bypassCustomProtocolHandlers: true,
      })
    }

    try {
      const data = await buildIndexHtmlWithCsp(filePath)
      return new Response(data, {
        headers: { 'Content-Type': 'text/html' },
      })
    } catch (error) {
      console.log('[CSP] failed to inject CSP into index.html:', error)
      return net.fetch(request, { bypassCustomProtocolHandlers: true })
    }
  })
}
