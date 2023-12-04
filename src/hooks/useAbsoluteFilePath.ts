import { BROWSER_FILE_NAME, IndexLoaderData, paths } from 'Router'
import { useRouteLoaderData } from 'react-router-dom'

export function useAbsoluteFilePath() {
  const routeData = useRouteLoaderData(paths.FILE) as IndexLoaderData

  return (
    paths.FILE +
    '/' +
    encodeURIComponent(routeData?.file?.path || BROWSER_FILE_NAME)
  )
}
