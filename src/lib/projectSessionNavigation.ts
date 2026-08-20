import type { App } from '@src/lib/app'
import fsZds from '@src/lib/fs-zds'
import {
  PATHS,
  joinRouterPaths,
  safeEncodeForRouterPaths,
} from '@src/lib/paths'
import { projectSession } from '@src/registry/contracts/projectSession'
import { routerService } from '@src/registry/contracts/router'

const normalizePathForComparison = (path: string) =>
  fsZds.resolve(path).replace(/\\/g, '/')

const isPathAtOrUnder = (path: string, targetPath: string) => {
  const normalizedPath = normalizePathForComparison(path)
  const normalizedTargetPath = normalizePathForComparison(targetPath)
  return (
    normalizedPath === normalizedTargetPath ||
    normalizedPath.startsWith(`${normalizedTargetPath}/`)
  )
}

export async function navigateToProjectFile({
  app,
  filePath,
  subRoute = '',
  openFile = true,
  onProjectLoaderComplete,
}: {
  app: App
  filePath: string
  subRoute?: string
  openFile?: boolean
  onProjectLoaderComplete?: () => void
}) {
  const session = app.registry.get(projectSession)
  const project = session.getProject()
  const router = app.registry.get(routerService)
  const targetPath = joinRouterPaths(
    PATHS.FILE,
    safeEncodeForRouterPaths(filePath),
    subRoute
  )

  await router.navigate(targetPath)

  if (openFile && project && isPathAtOrUnder(filePath, project.path)) {
    await session.openFile({
      path: filePath,
      editor: app.singletons.kclManager,
    })
  }

  onProjectLoaderComplete?.()
}

export function navigateToProject({
  app,
  projectPath,
  subRoute = '',
}: {
  app: App
  projectPath: string
  subRoute?: string
}) {
  void app.registry
    .get(routerService)
    .navigate(
      joinRouterPaths(
        PATHS.FILE,
        safeEncodeForRouterPaths(projectPath),
        subRoute
      )
    )
}
