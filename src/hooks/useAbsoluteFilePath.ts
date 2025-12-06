import { useRouteLoaderData } from 'react-router-dom'

import { PATHS } from '@src/lib/paths'
import { type IndexLoaderData } from '@src/lib/types'

export function useAbsoluteFilePath() {
  const routeData = useRouteLoaderData(PATHS.FILE) as IndexLoaderData

  if (!routeData?.file) {
    return undefined
  }

  return PATHS.FILE + '/' + encodeURIComponent(routeData?.file?.path)
}
