import type { KclManager } from '@src/lang/KclManager'
import {
  cloneOpenedProjectToCloudLibrary,
  updateProjectTitleForPublication,
} from '@src/lib/cloudProjects/cloneOpenedProjectToCloudLibrary'
import type { CloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import fsZds from '@src/lib/fs-zds'
import type { Project } from '@src/lib/project'
import { CLOUD_PROJECT_LIBRARY_TYPE } from '@src/lib/projectLibraries'
import { createPublicationWorkflow } from '@src/lib/publishing/workflow'
import { isErr } from '@src/lib/trap'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import type {
  HomeProjectActionsService,
  HomeProjectEntry,
} from '@src/registry/contracts/homeProjects'
import type { NavigateFunction, NavigateOptions, To } from 'react-router-dom'

/** Legacy project/storage translations stay outside the reusable publication workflow. */
export function createLegacyPublicationWorkflow({
  project: sourceProject,
  kclManager,
  isCurrent,
  fileOperations,
  cloud,
  actions,
  getEntries,
  token,
  navigate,
  willCloneProjectToCloud,
}: {
  project: Project
  kclManager: Pick<
    KclManager,
    'wasmInstancePromise' | 'path' | 'code' | 'writeToFile'
  >
  isCurrent: () => boolean
  fileOperations: FileOperationsRegistryService
  cloud: Pick<
    CloudStorageService,
    'idFor' | 'publishCurrentProject' | 'getCurrentProjectPublicationDetails'
  >
  actions:
    | Pick<
        HomeProjectActionsService,
        'getCloneToLibraryTargets' | 'cloneToLibrary' | 'canRename' | 'rename'
      >
    | undefined
  getEntries: () => readonly HomeProjectEntry[]
  token: string
  navigate: NavigateFunction
  willCloneProjectToCloud: boolean
}) {
  const project = { ...sourceProject }
  const navigateIfCurrent: NavigateFunction = (
    to: To | number,
    options?: NavigateOptions
  ) => {
    if (!isCurrent()) return
    return typeof to === 'number' ? navigate(to) : navigate(to, options)
  }
  return createPublicationWorkflow({
    loadDetails: async () => {
      if (!token || !isCurrent()) return null
      const wasmInstance = await kclManager.wasmInstancePromise
      if (!isCurrent()) return null
      return cloud.getCurrentProjectPublicationDetails({
        fileOperations,
        token,
        project,
        wasmInstance,
      })
    },
    prepare: async (submission) => {
      if (!isCurrent()) return new Error('The project is no longer open.')
      const file = { path: kclManager.path, contents: kclManager.code }
      const entries = getEntries()
      const wasmInstance = await kclManager.wasmInstancePromise
      if (!isCurrent() || kclManager.path !== file.path)
        return new Error(
          'The active project or file changed before publishing.'
        )
      const saved = await kclManager.writeToFile(file.contents)
      if (isErr(saved)) return saved
      if (!isCurrent() || kclManager.path !== file.path)
        return new Error(
          'The active project or file changed before publishing.'
        )
      const publicationTitle = submission.title.trim()
      let publicationProject = project
      let publicationFilePath = file.path
      let publicationFileContents = file.contents
      if (willCloneProjectToCloud) {
        const relativeFilePath = fsZds.relative(project.path, file.path)
        const created = await cloneOpenedProjectToCloudLibrary({
          actions,
          entries,
          projectPath: project.path,
          navigate: navigateIfCurrent,
          title: publicationTitle,
        })
        if (isErr(created))
          return new Error(
            'The project could not be cloned to Personal Cloud.',
            { cause: created }
          )
        publicationFilePath = fsZds.join(created.projectPath, relativeFilePath)
        publicationFileContents = new TextDecoder().decode(
          await fileOperations.readFile(publicationFilePath)
        )
        publicationProject = {
          ...project,
          title: publicationTitle,
          name: fsZds.basename(created.projectPath),
          path: created.projectPath,
          default_file: created.defaultFile,
          libraryPath: fsZds.dirname(created.projectPath),
          libraryType: CLOUD_PROJECT_LIBRARY_TYPE,
        }
      } else {
        const updated = await updateProjectTitleForPublication({
          actions,
          entries,
          projectPath: project.path,
          title: publicationTitle,
        })
        if (isErr(updated))
          return new Error('The project title could not be updated.', {
            cause: updated,
          })
        publicationProject = { ...project, title: publicationTitle }
      }
      const remoteProjectId = willCloneProjectToCloud
        ? cloud.idFor(publicationProject.path)
        : undefined
      return {
        publish: () =>
          cloud.publishCurrentProject({
            fileOperations,
            token,
            project: publicationProject,
            currentFilePath: publicationFilePath,
            currentFileContents: publicationFileContents,
            wasmInstance,
            submission,
            remoteProjectId,
          }),
        loadDetails: (publishedId: string) =>
          cloud.getCurrentProjectPublicationDetails({
            fileOperations,
            token,
            project: publicationProject,
            wasmInstance,
            remoteProjectId: publishedId,
          }),
      }
    },
  })
}
