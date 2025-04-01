import { BROWSER_PATH, PATHS } from 'lib/paths'
import { type IndexLoaderData } from 'lib/types'
import { useRouteLoaderData } from 'react-router-dom'

export function useAbsoluteFilePath() {
  const routeData = useRouteLoaderData(PATHS.FILE) as IndexLoaderData

  return (
    PATHS.FILE + '/' + encodeURIComponent(routeData?.file?.path || BROWSER_PATH)
  )
}
