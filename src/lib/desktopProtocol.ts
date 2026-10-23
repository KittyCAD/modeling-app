import { ZOO_STUDIO_PROTOCOL } from '@src/lib/constants'

export function getDesktopRendererPath(pathOrUrl: string) {
  const protocol = `${ZOO_STUDIO_PROTOCOL}://`
  // Leave URL escapes intact for the router to decode path and query values.
  return pathOrUrl.startsWith(protocol)
    ? pathOrUrl.slice(protocol.length)
    : decodeURI(pathOrUrl)
}
