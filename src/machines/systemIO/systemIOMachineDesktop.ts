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
  const message = input.override ? `Succesfully overwrote ${numberOfFiles} ${fileText}` : `Successfully created ${numberOfFiles} ${fileText}`
  return {
    message,
    fileName: '',
    projectName: '',
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
          requestedFileName: string
          requestedCode: string
          rootContext: AppMachineContext
        }
      }) => {
        const requestedProjectName = input.requestedProjectName
        const requestedFileName = input.requestedFileName
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
          entryName: requestedFileName,
          baseDir,
        })
        const configuration = await readAppSettingsFile()

        // Create the project around the file if newProject
        await createNewProjectDirectory(
          newProjectName,
          requestedCode,
          configuration,
          newFileName
        )

        return {
          message: 'File created successfully',
          fileName: newFileName,
          projectName: newProjectName,
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
        return await sharedBulkCreateWorkflow({ input })
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
        }
      }) => {
        const message = await sharedBulkCreateWorkflow({
          input: {
            ...input,
            override: input.override,
          },
        })
        message.projectName = input.requestedProjectName
        return message
      }
    ),
  },
})
