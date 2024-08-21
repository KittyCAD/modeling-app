import { type IndexLoaderData } from 'lib/types'
import { BROWSER_PATH, PATHS } from 'lib/paths'
import { useRouteLoaderData } from 'react-router-dom'
import { isDesktop } from 'lib/isDesktop'

export function useAbsoluteFilePath() {
  const routeData = useRouteLoaderData(PATHS.FILE) as IndexLoaderData

  const sep = isDesktop() ? window.electron.sep : '/'

  return (
    PATHS.FILE +
    '/' +
    encodeURIComponent(
      routeData?.file?.path + sep + routeData?.file?.name || BROWSER_PATH
    )
  )
}
