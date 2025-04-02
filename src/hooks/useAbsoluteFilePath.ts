import { useRouteLoaderData } from 'react-router-dom'

import { BROWSER_PATH, PATHS } from '@src/lib/paths'
import { type IndexLoaderData } from '@src/lib/types'

export function useAbsoluteFilePath() {
  const routeData = useRouteLoaderData(PATHS.FILE) as IndexLoaderData

  return (
    PATHS.FILE + '/' + encodeURIComponent(routeData?.file?.path || BROWSER_PATH)
  )
}
