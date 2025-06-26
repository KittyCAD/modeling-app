import {
  createNewProjectDirectory,
  getProjectInfo,
  mkdirOrNOOP,
  readAppSettingsFile,
  renameProjectDirectory,
} from '@src/lib/desktop'
import {
  doesProjectNameNeedInterpolated,
  getNextFileName,
  getNextProjectIndex,
  getUniqueProjectName,
  interpolateProjectNameWithIndex,
} from '@src/lib/desktopFS'
import type { Project } from '@src/lib/project'
import { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import type {
  RequestedKCLFile,
  SystemIOContext,
} from '@src/machines/systemIO/utils'
import {
  NO_PROJECT_DIRECTORY,
  SystemIOMachineActors,
} from '@src/machines/systemIO/utils'
import { fromPromise } from 'xstate'
import type { AppMachineContext } from '@src/lib/types'
import {
  getProjectDirectoryFromKCLFilePath,
  getStringAfterLastSeparator,
  parentPathRelativeToProject,
} from '@src/lib/paths'

const sharedBulkCreateWorkflow = async ({
  input,
}: {
  input: {
    context: SystemIOContext
    files: RequestedKCLFile[]
    rootContext: AppMachineContext
    override?: boolean
  }
}) => {
  const configuration = await readAppSettingsFile()
  for (let fileIndex = 0; fileIndex < input.files.length; fileIndex++) {
    const file = input.files[fileIndex]
    const requestedProjectName = file.requestedProjectName
    const requestedFileName = file.requestedFileName
    const requestedCode = file.requestedCode
    const folders = input.context.folders

    let newProjectName = requestedProjectName

    if (!newProjectName) {
      newProjectName = getUniqueProjectName(
        input.context.defaultProjectFolderName,
        input.context.folders
      )
    }

    const needsInterpolated = doesProjectNameNeedInterpolated(newProjectName)
    if (needsInterpolated) {
      const nextIndex = getNextProjectIndex(newProjectName, folders)
      newProjectName = interpolateProjectNameWithIndex(
        newProjectName,
        nextIndex
      )
    }

    const baseDir = window.electron.join(
      input.context.projectDirectoryPath,
      newProjectName
    )
    // If override is true, use the requested filename directly
    const fileName = input.override
      ? requestedFileName
      : getNextFileName({
          entryName: requestedFileName,
          baseDir,
        }).name

    // Create the project around the file if newProject
    await createNewProjectDirectory(
      newProjectName,
      requestedCode,
      configuration,
      fileName
    )
  }
  const numberOfFiles = input.files.length
  const fileText = numberOfFiles > 1 ? 'files' : 'file'
  const message = input.override
    ? `Successfully overwrote ${numberOfFiles} ${fileText}`
    : `Successfully created ${numberOfFiles} ${fileText}`
  return {
    message,
    fileName: '',
    projectName: '',
    subRoute: 'subRoute' in input ? input.subRoute : '',
  }
}

export const systemIOMachineDesktop = systemIOMachine.provide({
  actors: {
    [SystemIOMachineActors.readFoldersFromProjectDirectory]: fromPromise(
      async ({ input: context }: { input: SystemIOContext }) => {
        const projects = []
        const projectDirectoryPath = context.projectDirectoryPath
        if (projectDirectoryPath === NO_PROJECT_DIRECTORY) {
          return []
        }
        await mkdirOrNOOP(projectDirectoryPath)
        // Gotcha: readdir will list all folders at this project directory even if you do not have readwrite access on the directory path
        const entries = await window.electron.readdir(projectDirectoryPath)
        const { value: canReadWriteProjectDirectory } =
          await window.electron.canReadWriteDirectory(projectDirectoryPath)

        for (let entry of entries) {
          // Skip directories that start with a dot
          if (entry.startsWith('.')) {
            continue
          }
          const projectPath = window.electron.path.join(
            projectDirectoryPath,
            entry
          )

          // if it's not a directory ignore.
          // Gotcha: statIsDirectory will work even if you do not have read write permissions on the project path
          const isDirectory = await window.electron.statIsDirectory(projectPath)
          if (!isDirectory) {
            continue
          }
          const project: Project = await getProjectInfo(projectPath)
          if (
            project.kcl_file_count === 0 &&
            project.readWriteAccess &&
            canReadWriteProjectDirectory
          ) {
            continue
          }
          projects.push(project)
        }
        return projects
      }
    ),
    [SystemIOMachineActors.createProject]: fromPromise(
      async ({
        input,
      }: {
        input: { context: SystemIOContext; requestedProjectName: string }
      }) => {
        const folders = input.context.folders
        const requestedProjectName = input.requestedProjectName
        const uniqueName = getUniqueProjectName(requestedProjectName, folders)
        await createNewProjectDirectory(uniqueName)
        return {
          message: `Successfully created "${uniqueName}"`,
          name: uniqueName,
        }
      }
    ),
    [SystemIOMachineActors.renameProject]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          requestedProjectName: string
          projectName: string
        }
      }) => {
        const folders = input.context.folders
        const requestedProjectName = input.requestedProjectName
        const projectName = input.projectName
        let newProjectName: string = requestedProjectName
        if (doesProjectNameNeedInterpolated(requestedProjectName)) {
          const nextIndex = getNextProjectIndex(requestedProjectName, folders)
          newProjectName = interpolateProjectNameWithIndex(
            requestedProjectName,
            nextIndex
          )
        }

        // Toast an error if the project name is taken
        if (folders.find((p) => p.name === newProjectName)) {
          return Promise.reject(
            new Error(`Project with name "${newProjectName}" already exists`)
          )
        }

        await renameProjectDirectory(
          window.electron.path.join(
            input.context.projectDirectoryPath,
            projectName
          ),
          newProjectName
        )

        return {
          message: `Successfully renamed "${projectName}" to "${newProjectName}"`,
          oldName: projectName,
          newName: newProjectName,
        }
      }
    ),
    [SystemIOMachineActors.deleteProject]: fromPromise(
      async ({
        input,
      }: {
        input: { context: SystemIOContext; requestedProjectName: string }
      }) => {
        await window.electron.rm(
          window.electron.path.join(
            input.context.projectDirectoryPath,
            input.requestedProjectName
          ),
          {
            recursive: true,
          }
        )

        return {
          message: `Successfully deleted "${input.requestedProjectName}"`,
          name: input.requestedProjectName,
        }
      }
    ),
    [SystemIOMachineActors.createKCLFile]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          requestedProjectName: string
          requestedFileNameWithExtension: string
          requestedCode: string
          rootContext: AppMachineContext
          requestedSubRoute?: string
        }
      }) => {
        const requestedProjectName = input.requestedProjectName
        const requestedFileNameWithExtension =
          input.requestedFileNameWithExtension
        const requestedCode = input.requestedCode
        const folders = input.context.folders

        let newProjectName = requestedProjectName

        if (!newProjectName) {
          newProjectName = getUniqueProjectName(
            input.context.defaultProjectFolderName,
            input.context.folders
          )
        }

        const needsInterpolated =
          doesProjectNameNeedInterpolated(newProjectName)
        if (needsInterpolated) {
          const nextIndex = getNextProjectIndex(newProjectName, folders)
          newProjectName = interpolateProjectNameWithIndex(
            newProjectName,
            nextIndex
          )
        }

        const baseDir = window.electron.join(
          input.context.projectDirectoryPath,
          newProjectName
        )
        const { name: newFileName } = getNextFileName({
          entryName: requestedFileNameWithExtension,
          baseDir,
        })

        const configuration = await readAppSettingsFile()

        // Create the project around the file if newProject
        try {
          const result = await createNewProjectDirectory(
            newProjectName,
            requestedCode,
            configuration,
            newFileName
          )
          console.log(result)
        } catch (e) {
          console.error(e)
        }

        return {
          message: 'Successfully created file.',
          fileName: newFileName,
          projectName: newProjectName,
          subRoute: input.requestedSubRoute || '',
        }
      }
    ),
    [SystemIOMachineActors.checkReadWrite]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          requestedProjectDirectoryPath: string
        }
      }) => {
        const requestProjectDirectoryPath = input.requestedProjectDirectoryPath
        if (!requestProjectDirectoryPath) {
          return { value: true, error: undefined }
        }
        const result = await window.electron.canReadWriteDirectory(
          requestProjectDirectoryPath
        )
        return result
      }
    ),
    [SystemIOMachineActors.deleteKCLFile]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          requestedProjectName: string
          requestedFileName: string
        }
      }) => {
        const path = window.electron.path.join(
          input.context.projectDirectoryPath,
          input.requestedProjectName,
          input.requestedFileName
        )
        await window.electron.rm(path)
        return {
          message: 'File deleted successfully',
          projectName: input.requestedProjectName,
          fileName: input.requestedFileName,
        }
      }
    ),
    [SystemIOMachineActors.bulkCreateKCLFiles]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          files: RequestedKCLFile[]
          rootContext: AppMachineContext
        }
      }) => {
        const message = await sharedBulkCreateWorkflow({ input })
        return {
          ...message,
          subRoute: '',
        }
      }
    ),
    [SystemIOMachineActors.bulkCreateKCLFilesAndNavigateToProject]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          files: RequestedKCLFile[]
          rootContext: AppMachineContext
          requestedProjectName: string
          override?: boolean
          requestedSubRoute?: string
        }
      }) => {
        const message = await sharedBulkCreateWorkflow({
          input: {
            ...input,
            override: input.override,
          },
        })
        return {
          ...message,
          projectName: input.requestedProjectName,
          subRoute: input.requestedSubRoute || '',
        }
      }
    ),
    [SystemIOMachineActors.bulkCreateKCLFilesAndNavigateToFile]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          files: RequestedKCLFile[]
          rootContext: AppMachineContext
          requestedProjectName: string
          override?: boolean
          requestedFileNameWithExtension: string
          requestedSubRoute?: string
        }
      }) => {
        const message = await sharedBulkCreateWorkflow({
          input: {
            ...input,
            override: input.override,
          },
        })
        return {
          ...message,
          projectName: input.requestedProjectName,
          fileName: input.requestedFileNameWithExtension || '',
          subRoute: input.requestedSubRoute || '',
        }
      }
    ),
    [SystemIOMachineActors.renameFolder]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          rootContext: AppMachineContext
          requestedFolderName: string
          folderName: string
          absolutePathToParentDirectory: string
          requestedProjectName?: string
          requestedFileNameWithExtension?: string
        }
      }) => {
        const {
          folderName,
          requestedFolderName,
          absolutePathToParentDirectory,
        } = input
        const oldPath = window.electron.path.join(
          absolutePathToParentDirectory,
          folderName
        )
        const newPath = window.electron.path.join(
          absolutePathToParentDirectory,
          requestedFolderName
        )

        const requestedProjectName = input.requestedProjectName || ''
        const requestedFileNameWithExtension =
          input.requestedFileNameWithExtension || ''

        // ignore the rename if the resulting paths are the same
        if (oldPath === newPath) {
          return {
            message: `Old folder is the same as new.`,
            folderName,
            requestedFolderName,
            requestedProjectName,
            requestedFileNameWithExtension,
          }
        }

        // if there are any siblings with the same name, report error.
        const entries = await window.electron.readdir(
          window.electron.path.dirname(newPath)
        )

        for (let entry of entries) {
          if (entry === requestedFolderName) {
            return Promise.reject(new Error('Folder name already exists.'))
          }
        }

        window.electron.rename(oldPath, newPath)

        return {
          message: `Successfully renamed folder "${folderName}" to "${requestedFolderName}"`,
          folderName,
          requestedFolderName,
          requestedProjectName,
          requestedFileNameWithExtension,
        }
      }
    ),
    [SystemIOMachineActors.renameFile]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          rootContext: AppMachineContext
          requestedFileNameWithExtension: string
          fileNameWithExtension: string
          absolutePathToParentDirectory: string
        }
      }) => {
        const {
          fileNameWithExtension,
          requestedFileNameWithExtension,
          absolutePathToParentDirectory,
        } = input

        const oldPath = window.electron.path.join(
          absolutePathToParentDirectory,
          fileNameWithExtension
        )
        const newPath = window.electron.path.join(
          absolutePathToParentDirectory,
          requestedFileNameWithExtension
        )

        const projectDirectoryPath = input.context.projectDirectoryPath
        const projectName = getProjectDirectoryFromKCLFilePath(
          newPath,
          projectDirectoryPath
        )
        const filePathWithExtensionRelativeToProject =
          parentPathRelativeToProject(newPath, projectDirectoryPath)

        // no-op
        if (oldPath === newPath) {
          return {
            message: `Old file is the same as new.`,
            projectName: projectName,
            filePathWithExtensionRelativeToProject,
          }
        }

        // if there are any siblings with the same name, report error.
        const entries = await window.electron.readdir(
          window.electron.path.dirname(newPath)
        )

        for (let entry of entries) {
          if (entry === requestedFileNameWithExtension) {
            return Promise.reject(new Error('Filename already exists.'))
          }
        }

        window.electron.rename(oldPath, newPath)

        return {
          message: `Successfully renamed file "${fileNameWithExtension}" to "${requestedFileNameWithExtension}"`,
          projectName: projectName,
          filePathWithExtensionRelativeToProject,
        }
      }
    ),
    [SystemIOMachineActors.deleteFileOrFolder]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          rootContext: AppMachineContext
          requestedPath: string
          requestedProjectName?: string | undefined
        }
      }) => {
        await window.electron.rm(input.requestedPath, { recursive: true })
        let response = {
          message: 'File deleted successfully',
          requestedPath: input.requestedPath,
          requestedProjectName: input.requestedProjectName || '',
        }
        return response
      }
    ),
    [SystemIOMachineActors.createBlankFile]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          rootContext: AppMachineContext
          requestedAbsolutePath: string
        }
      }) => {
        const fileNameWithExtension = getStringAfterLastSeparator(
          input.requestedAbsolutePath
        )
        try {
          const result = await window.electron.stat(input.requestedAbsolutePath)
          if (result) {
            return Promise.reject(
              new Error(`File ${fileNameWithExtension} already exists`)
            )
          }
        } catch (e) {
          console.error(e)
        }
        await window.electron.writeFile(input.requestedAbsolutePath, '')
        return {
          message: `File ${fileNameWithExtension} written successfully`,
          requestedAbsolutePath: input.requestedAbsolutePath,
        }
      }
    ),
    [SystemIOMachineActors.createBlankFolder]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          rootContext: AppMachineContext
          requestedAbsolutePath: string
        }
      }) => {
        const folderName = getStringAfterLastSeparator(
          input.requestedAbsolutePath
        )
        try {
          const result = await window.electron.stat(input.requestedAbsolutePath)
          if (result) {
            return Promise.reject(
              new Error(`Folder ${folderName} already exists`)
            )
          }
        } catch (e) {
          if (e === 'ENOENT') {
            console.warn(`checking if folder is created, ${input.requestedAbsolutePath}`)
            console.warn(e)
          } else {
            console.error(e)
          }
        }
        await window.electron.mkdir(input.requestedAbsolutePath, {
          recursive: true,
        })
        return {
          message: `Folder ${folderName} written successfully`,
          requestedAbsolutePath: input.requestedAbsolutePath,
        }
      }
    ),
  },
})
