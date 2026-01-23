import fsZds from '@src/lib/fs-zds'
import path from 'path'
import {
  statIsDirectory,
  canReadWriteDirectory,
  createNewProjectDirectory,
  getAppSettingsFilePath,
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
import {
  getProjectDirectoryFromKCLFilePath,
  getStringAfterLastSeparator,
  parentPathRelativeToProject,
} from '@src/lib/paths'
import type { Project } from '@src/lib/project'
import type { AppMachineContext } from '@src/lib/types'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import type {
  RequestedKCLFile,
  SystemIOContext,
} from '@src/machines/systemIO/utils'
import {
  NO_PROJECT_DIRECTORY,
  SystemIOMachineActors,
  jsonToMlConversations,
  mlConversationsToJson,
  collectProjectFiles,
} from '@src/machines/systemIO/utils'
import { fromPromise } from 'xstate'

const ML_CONVERSATIONS_FILE_NAME = 'ml-conversations.json'

const sharedBulkCreateWorkflow = async ({
  input,
}: {
  input: {
    context: SystemIOContext
    files: RequestedKCLFile[]
    rootContext: AppMachineContext
    wasmInstance: ModuleType
    override?: boolean
  }
}) => {
  const configuration = await readAppSettingsFile(input.wasmInstance)
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

    const baseDir = path.join(
      input.context.projectDirectoryPath,
      newProjectName
    )
    // If override is true, use the requested filename directly
    const fileName = input.override
      ? requestedFileName
      : (
          await getNextFileName({
            entryName: requestedFileName,
            baseDir,
            wasmInstance: input.wasmInstance,
          })
        ).name

    // Create the project around the file if newProject
    await createNewProjectDirectory(
      newProjectName,
      input.wasmInstance,
      requestedCode,
      configuration,
      fileName,
      input.context.projectDirectoryPath
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

const sharedBulkDeleteWorkflow = async ({
  input,
}: {
  input: {
    requestedProjectName: string
    context: SystemIOContext
    files: RequestedKCLFile[]
    rootContext: AppMachineContext
    wasmInstance: ModuleType
  }
}) => {
  const project = input.context.folders.find(
    (f) => f.name === input.requestedProjectName
  )

  if (!project) return Promise.reject(new Error("Couldn't find project"))

  const filesInProject = await collectProjectFiles({
    selectedFileContents: '',
    fileNames: [],
    projectContext: project,
  })

  // requestedFileName is the relative path too.
  const filesToDelete = filesInProject.filter(
    (f1) =>
      input.files.some((f2) => f1.relPath === f2.requestedFileName) === false
  )

  for (const file of filesToDelete) {
    if (file.type === 'other') continue
    await fsZds.rm(file.absPath)
  }

  // How many files we deleted successfully
  return filesToDelete.length
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
        const entries = await fsZds.readdir(projectDirectoryPath)
        const { value: canReadWriteProjectDirectory } =
          await canReadWriteDirectory(projectDirectoryPath)

        for (let entry of entries) {
          // Skip directories that start with a dot
          if (entry.startsWith('.')) {
            continue
          }
          const projectPath = path.join(projectDirectoryPath, entry)

          // if it's not a directory ignore.
          // Gotcha: statIsDirectory will work even if you do not have read write permissions on the project path
          const isDirectory = await statIsDirectory(projectPath)
          if (!isDirectory) {
            continue
          }
          const project: Project = await getProjectInfo(
            projectPath,
            await context.wasmInstancePromise
          )
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
        await createNewProjectDirectory(
          uniqueName,
          await input.context.wasmInstancePromise
        )
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
          redirect: boolean
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
          path.join(input.context.projectDirectoryPath, projectName),
          newProjectName
        )

        return {
          message: `Successfully renamed "${projectName}" to "${newProjectName}"`,
          oldName: projectName,
          newName: newProjectName,
          redirect: input.redirect,
        }
      }
    ),
    [SystemIOMachineActors.deleteProject]: fromPromise(
      async ({
        input,
      }: {
        input: { context: SystemIOContext; requestedProjectName: string }
      }) => {
        await fsZds.rm(
          path.join(
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
          wasmInstancePromise: Promise<ModuleType>
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

        const wasmInstance = await input.wasmInstancePromise

        const baseDir = path.join(
          input.context.projectDirectoryPath,
          newProjectName
        )
        const { name: newFileName } = await getNextFileName({
          entryName: requestedFileNameWithExtension,
          baseDir,
          wasmInstance,
        })

        const configuration = await readAppSettingsFile(wasmInstance)

        // Create the project around the file if newProject
        await createNewProjectDirectory(
          newProjectName,
          await input.wasmInstancePromise,
          requestedCode,
          configuration,
          newFileName,
          input.context.projectDirectoryPath
        )

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
        const result = await canReadWriteDirectory(requestProjectDirectoryPath)
        if (result instanceof Error) {
          return { value: false, error: result }
        }
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
        const pathToRemove = path.join(
          input.context.projectDirectoryPath,
          input.requestedProjectName,
          input.requestedFileName
        )
        await fsZds.rm(pathToRemove)
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
          wasmInstancePromise: Promise<ModuleType>
        }
      }) => {
        const { wasmInstancePromise, ...otherInput } = input
        const wasmInstance = await wasmInstancePromise
        const message = await sharedBulkCreateWorkflow({
          input: {
            ...otherInput,
            wasmInstance,
          },
        })
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
          wasmInstancePromise: Promise<ModuleType>
        }
      }) => {
        const { wasmInstancePromise, ...otherInput } = input
        const wasmInstance = await wasmInstancePromise
        const message = await sharedBulkCreateWorkflow({
          input: {
            ...otherInput,
            wasmInstance,
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
    [SystemIOMachineActors.bulkCreateAndDeleteKCLFilesAndNavigateToFile]:
      fromPromise(
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
          const wasmInstance = await input.context.wasmInstancePromise
          const message = await sharedBulkCreateWorkflow({
            input: {
              ...input,
              wasmInstance,
              override: input.override,
            },
          })
          // We won't delete until everything's created / updated first.
          const totalDeleted = await sharedBulkDeleteWorkflow({
            input: {
              ...input,
              wasmInstance,
            },
          })

          message.message += `, ${totalDeleted} deleted`

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
        const wasmInstance = await input.context.wasmInstancePromise
        const message = await sharedBulkCreateWorkflow({
          input: {
            ...input,
            wasmInstance,
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
        const oldPath = path.join(absolutePathToParentDirectory, folderName)
        const newPath = path.join(
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
        const entries = await fsZds.readdir(path.dirname(newPath))

        for (let entry of entries) {
          if (entry === requestedFolderName) {
            return Promise.reject(new Error('Folder name already exists.'))
          }
        }

        await fsZds.rename(oldPath, newPath)

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

        const oldPath = path.join(
          absolutePathToParentDirectory,
          fileNameWithExtension
        )
        const newPath = path.join(
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
        const entries = await fsZds.readdir(path.dirname(newPath))

        for (let entry of entries) {
          if (entry === requestedFileNameWithExtension) {
            return Promise.reject(new Error('Filename already exists.'))
          }
        }

        await fsZds.rename(oldPath, newPath)

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
        await fsZds.rm(input.requestedPath, { recursive: true })
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
          const result = await fsZds.stat(input.requestedAbsolutePath)
          if (result) {
            return Promise.reject(
              new Error(`File ${fileNameWithExtension} already exists`)
            )
          }
        } catch (e) {
          console.error(e)
        }
        await fsZds.writeFile(input.requestedAbsolutePath, new Uint8Array())
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
          const result = await fsZds.stat(input.requestedAbsolutePath)
          if (result) {
            return Promise.reject(
              new Error(`Folder ${folderName} already exists`)
            )
          }
        } catch (e) {
          if (e === 'ENOENT') {
            console.warn(
              `checking if folder is created, ${input.requestedAbsolutePath}`
            )
            console.warn(e)
          } else {
            console.error(e)
          }
        }
        await fsZds.mkdir(input.requestedAbsolutePath, {
          recursive: true,
        })
        return {
          message: `Folder ${folderName} written successfully`,
          requestedAbsolutePath: input.requestedAbsolutePath,
        }
      }
    ),
    [SystemIOMachineActors.copyRecursive]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          rootContext: AppMachineContext
          src: string
          target: string
        }
      }) => {
        await fsZds.cp(input.src, input.target, {
          recursive: true,
          force: false,
        })
        return {
          message: 'Copied successfully',
          requestedAbsolutePath: '',
        }
      }
    ),
    [SystemIOMachineActors.moveRecursive]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          rootContext: AppMachineContext
          src: string
          target: string
          successMessage?: string
          requestedProjectName?: string
        }
      }) => {
        try {
          // TODO: this force deletion behavior assumes this move is only
          // really used in our archive/restore workflow. We should make
          // dedicated archive/restore code paths for that if we need cases
          // where we want to check with the user before going through with forcing.
          await fsZds.mkdir(path.dirname(input.target), { recursive: true })
          await fsZds.rename(input.src, input.target)
        } catch (e: unknown) {
          console.log(e)
        }
        return {
          message: input.successMessage || 'Moved successfully',
          requestedAbsolutePath: '',
          requestedProjectName: input.requestedProjectName || '',
        }
      }
    ),
    [SystemIOMachineActors.getMlEphantConversations]: fromPromise(async () => {
      // In the future we can add cache behavior but it's really pointless
      // for the amount of data and frequency we're dealing with.

      // We need the settings path to find the sibling `ml-conversations.json`
      try {
        const json = await fsZds.readFile(
          path.join(
            path.dirname(await getAppSettingsFilePath()),
            ML_CONVERSATIONS_FILE_NAME
          ),
          { encoding: 'utf-8' }
        )
        return jsonToMlConversations(json ?? '')
      } catch (e) {
        console.warn('Cannot get conversations', e)
        return new Map()
      }
    }),
    [SystemIOMachineActors.saveMlEphantConversations]: fromPromise(
      async (args: {
        input: {
          context: SystemIOContext
          event: {
            data: {
              projectId: string
              conversationId: string
            }
          }
        }
      }) => {
        const next: Map<any, any> = new Map(
          args.input.context.mlEphantConversations
        )
        next.set(
          args.input.event.data.projectId,
          args.input.event.data.conversationId
        )
        const json = mlConversationsToJson(next)
        const te = new TextEncoder()
        await fsZds.writeFile(
          path.join(
            path.dirname(await getAppSettingsFilePath()),
            ML_CONVERSATIONS_FILE_NAME
          ),
          te.encode(json)
        )
        return next
      }
    ),
  },
})
