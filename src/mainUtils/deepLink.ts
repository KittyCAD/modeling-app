import { ZOO_STUDIO_PROTOCOL } from '@src/lib/constants'

export type ParsedDeepLink = {
  filteredPath: string
  environment?: string
}

export const parseDeepLink = (pathToOpen?: string): ParsedDeepLink => {
  if (!pathToOpen || !pathToOpen.startsWith(`${ZOO_STUDIO_PROTOCOL}://`)) {
    return { filteredPath: '' }
  }

  const urlNoProtocol = pathToOpen
    .replace(`${ZOO_STUDIO_PROTOCOL}://`, '')
    .replaceAll('%3D', '')
    .replaceAll('%3', '')
  const trimmed = urlNoProtocol.replace(/^\/+/, '')

  if (trimmed.startsWith('env/')) {
    const afterEnv = trimmed.slice('env/'.length)
    const envEndIndex = afterEnv.search(/[/?#]/)
    const envValue =
      envEndIndex === -1 ? afterEnv : afterEnv.slice(0, envEndIndex)
    const remainder = envEndIndex === -1 ? '' : afterEnv.slice(envEndIndex)

    return {
      environment: decodeURIComponent(envValue),
      filteredPath: decodeURI(remainder),
    }
  }

  return { filteredPath: decodeURI(urlNoProtocol) }
}
