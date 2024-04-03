import { type IndexLoaderData } from 'lib/types'
import { BROWSER_PATH, paths } from 'lib/paths'
import { useRouteLoaderData } from 'react-router-dom'

export function useAbsoluteFilePath() {
  const routeData = useRouteLoaderData(paths.FILE) as IndexLoaderData

  return (
    paths.FILE + '/' + encodeURIComponent(routeData?.file?.path || BROWSER_PATH)
  )
}
