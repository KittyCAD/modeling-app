import { BROWSER_FILE_NAME } from 'Router'
import { type IndexLoaderData } from 'lib/types'
import { paths } from 'lib/paths'
import { useRouteLoaderData } from 'react-router-dom'

export function useAbsoluteFilePath() {
  const routeData = useRouteLoaderData(paths.FILE) as IndexLoaderData

  return (
    paths.FILE +
    '/' +
    encodeURIComponent(routeData?.file?.path || BROWSER_FILE_NAME)
  )
}
