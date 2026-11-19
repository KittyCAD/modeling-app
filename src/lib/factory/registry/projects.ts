import type { App } from '@src/lib/app'
import { cloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import type { FactorySnapshot } from '@src/lib/factory/jobs'
import fsZds from '@src/lib/fs-zds'
import { findHomeProjectByPath } from '@src/lib/homeProjects'
import { CLOUD_PROJECT_LIBRARY_TYPE } from '@src/lib/projectLibraries'
import { collectProjectFilesForUpload } from '@src/lib/projectSession/projectFiles'
import {
  homeProjectActionsService,
  homeProjectEntriesFacet,
} from '@src/registry/contracts/homeProjects'
import { isErr } from '@src/lib/trap'

/** Capture one project's saved bytes; a local source is copied once without changing its identity. */
export async function captureFactoryProject(
  app: App,
  isCurrent: () => boolean
): Promise<FactorySnapshot> {
  const project = app.projectSignal.peek()
  if (!project || !isCurrent())
    return Promise.reject(new Error('Open a project before submitting.'))
  for (const editor of project.editors.values()) {
    if (!isCurrent())
      return Promise.reject(new Error('The project changed before submission.'))
    const result = await editor.writeToFile(editor.code)
    if (isErr(result)) return Promise.reject(result)
  }
  if (!isCurrent())
    return Promise.reject(new Error('The project changed before submission.'))
  const metadata = project.projectIORefSignal.peek()
  let path = project.path
  if (metadata.libraryType !== CLOUD_PROJECT_LIBRARY_TYPE) {
    const actions = app.registry.optional(homeProjectActionsService)
    const homeProject = findHomeProjectByPath(
      app.registry.get(homeProjectEntriesFacet),
      path
    )
    const target =
      homeProject &&
      actions
        ?.getCloneToLibraryTargets(homeProject)
        .find((item) => item.library.type === CLOUD_PROJECT_LIBRARY_TYPE)
    if (!actions || !homeProject || !target)
      return Promise.reject(
        new Error('No cloud library is available for this project.')
      )
    const created = await actions.cloneToLibrary(homeProject, target.library.id)
    if (!created?.defaultFile)
      return Promise.reject(new Error('The cloud copy could not be created.'))
    path = created.localProjectPath ?? fsZds.dirname(created.defaultFile)
  }
  if (!isCurrent())
    return Promise.reject(new Error('The project changed before submission.'))
  const cloud = app.registry.optional(cloudStorageService)
  const id = cloud?.idFor(path)
  if (!cloud || !id)
    return Promise.reject(new Error('The cloud project is unavailable.'))
  const files = await cloud.snapshot(id)
  if (!isCurrent())
    return Promise.reject(new Error('The project changed before submission.'))
  return { files }
}

export async function listFactoryEntrypoints(app: App) {
  const project = app.projectSignal.peek()
  if (!project) return []
  const files = await collectProjectFilesForUpload({
    fileOperations: app.fileOperations,
    projectRoot: project.path,
  })
  return files
    .map((file) => file.relativePath)
    .filter((path) => /\.kcl$/i.test(path))
}
