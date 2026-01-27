import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'node:url'
// @ts-ignore: TS1343
import * as packageJSON from '@root/package.json'
import { app, protocol } from 'electron'

import { ENVIRONMENT_FILE_NAME } from '@src/lib/constants'
import { getAppFolderName } from '@src/lib/appFolderName'

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
  const isStaging = packageJSON.name.includes('-staging')
  const isStagingOrDebug =
    isStaging ||
    packageJSON.version === '0.0.0' ||
    packageJSON.version === 'dev'
  return getAppFolderName({
    packageName: packageJSON.name,
    platform: process.platform,
    isStaging,
    isStagingOrDebug,
  })
}

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

const writeIndexHtmlWithCsp = async (indexPath: string) => {
  const domain = await readEnvironmentDomainForCsp()
  const csp = buildCsp(domain)
  const html = await fs.promises.readFile(indexPath, 'utf8')
  const metaTag = `<meta http-equiv="Content-Security-Policy" content="${csp}">`
  const withoutCsp = html.replace(CSP_META_REGEX, '')
  const updatedHtml = withoutCsp.replace(
    /<head[^>]*>/i,
    (match) => `${match}\n  ${metaTag}`
  )

  const userDataPath = app.getPath('userData')
  await fs.promises.mkdir(userDataPath, { recursive: true })
  const targetPath = path.join(userDataPath, 'index.csp.html')
  await fs.promises.writeFile(targetPath, updatedHtml, 'utf8')
  return targetPath
}

export const registerFileProtocolCsp = () => {
  protocol.interceptFileProtocol('file', (request, callback) => {
    void (async () => {
      const filePath = fileURLToPath(request.url)
      if (path.basename(filePath) !== 'index.html') {
        callback(filePath)
        return
      }
      try {
        const cspIndexPath = await writeIndexHtmlWithCsp(filePath)
        callback(cspIndexPath)
      } catch (error) {
        console.error('Failed to inject CSP into index.html', error)
        callback(filePath)
      }
    })()
  })
}
