import { FileAlreadyExists } from '@src/lib/fileSystem/fileOperations'
import { readTextFile } from '@src/lib/fileSystem/readTextFile'
import { getContainedRelativePath } from '@src/lib/fileSystem/pathContainment'
import { setProjectDefaultFileInProjectTomlContents } from '@src/lib/projectTomlMetadata'
import fsZds from '@src/lib/fs-zds'
import { reportRejection } from '@src/lib/trap'
import { isOffline } from '@src/lib/networkStatus'
import { getProjectInfo, writeProjectThumbnailFile } from '@src/lib/desktop'
import {
  PROJECT_SETTINGS_FILE_NAME,
  ASK_TO_OPEN_QUERY_PARAM,
  PROJECT_ID_QUERY_PARAM,
  EXECUTE_AST_INTERRUPT_ERROR_MESSAGE,
} from '@src/lib/constants'
import {
  PATHS,
  joinRouterPaths,
  safeEncodeForRouterPaths,
} from '@src/lib/paths'
import { shouldNavigateToRequestedPath } from '@src/routes/Onboarding/navigation'
import { routerService } from '@src/registry/contracts/router'
import { settingsService } from '@src/registry/contracts/settings'
import { engineConnectionService } from '@src/registry/contracts/engineConnection'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import { lspService } from '@src/lang/lsp/registry/contract'
import { ExpectedFileOperationError } from '@src/lib/fileSystem/operationErrors'
import {
  flushActiveTextFileWrite,
  adoptCloudTextSnapshot,
} from '@src/lib/activeTextFile'
import {
  defineRegistryItem,
  defineRegistryItemFactory,
  provideService,
} from '@kittycad/registry'
import { computed, signal, effect } from '@preact/signals-core'
import type { ZDSProject } from '@src/lib/projectSession'
import {
  createTextFileIO,
  type TextFileIO,
} from '@src/lib/projectSession/textFileIO'
import {
  type FileOperationsRegistryService,
  cloudStorageService,
  fileOperationsService,
} from '@src/registry/contracts/fileOperations'
import {
  projectSession,
  type ProjectSessionService,
} from '@src/registry/contracts/projectSession'

export const projectSessionExtension = defineRegistryItemFactory((ctx) => {
  const project = signal<ZDSProject | undefined>(undefined)
  let refreshGeneration = 0
  let reconciliationGeneration = 0
  const executingEditor = computed(() => {
    const currentProject = project.value
    const editor = currentProject?.executingEditor.value
    if (!currentProject || !editor) return undefined
    const execution = editor.execution
    const isCurrent = () =>
      project.peek() === currentProject &&
      currentProject.executingEditor.peek() === editor
    return {
      ...execution,
      executeCode: (code?: string) =>
        isCurrent() ? execution.executeCode(code) : Promise.resolve(),
      updateCode: (...args: Parameters<typeof execution.updateCode>) => {
        if (isCurrent()) execution.updateCode(...args)
      },
    }
  })
  const currentProjectLibraryId = signal<string | undefined>(undefined)
  let textFileIO: TextFileIO | undefined
  const electron = window.electron
  const cloudWatchers = new Map<string, () => void>()

  const serviceImpl: ProjectSessionService = {
    editorChanged: (path) => {
      const cloud = ctx.services.optional(cloudStorageService)
      if (cloud?.root && path.startsWith(`${cloud.root}${fsZds.sep}`))
        cloud.editorChanged(path)
    },
    writeThumbnail: (path, bytes) => {
      const cloud = ctx.services.optional(cloudStorageService)
      return cloud?.root && path.startsWith(`${cloud.root}${fsZds.sep}`)
        ? cloud.stageThumbnail(path, bytes)
        : writeProjectThumbnailFile(
            ctx.services.get(fileOperationsService),
            bytes,
            path
          )
    },
    get textFileIO() {
      return (textFileIO ??= createTextFileIO(
        ctx.services.get(fileOperationsService),
        {
          watch: (path, key, onEvent) => {
            const cloud = ctx.services.optional(cloudStorageService)
            if (
              cloud &&
              path.startsWith(
                `${cloud.root}${window.electron?.os.isWindows ? '\\' : '/'}`
              )
            ) {
              const watchKey = `${key}:${path}`
              cloudWatchers.get(watchKey)?.()
              cloudWatchers.set(
                watchKey,
                cloud.subscribe((changes) => {
                  for (const change of changes)
                    if (
                      change.path === path ||
                      change.path.startsWith(`${path}/`) ||
                      change.path.startsWith(`${path}\\`)
                    )
                      onEvent(change.eventType, change.path)
                })
              )
            } else electron?.watchFileOn(path, key, onEvent)
          },
          unwatch: (path, key) => {
            const watchKey = `${key}:${path}`
            cloudWatchers.get(watchKey)?.()
            cloudWatchers.delete(watchKey)
            electron?.watchFileOff(path, key)
          },
        }
      ))
    },
    refreshProject: async () => {
      const current = project.peek()
      if (!current) return
      const generation = ++refreshGeneration
      const metadata = current.projectIORefSignal.peek()
      const wasm = ctx.valueSpecs.get(wasmPromiseValueSpec)
      if (!wasm) return Promise.reject(new Error('Missing WASM promise.'))
      const refreshed = await getProjectInfo(
        ctx.services.get(fileOperationsService),
        current.path,
        await wasm,
        { createMissingEntrypoint: !metadata.cloudProjectId }
      )
      if (project.peek() !== current || refreshGeneration !== generation) return
      current.projectIORefSignal.value = {
        ...refreshed,
        cloudProjectId: metadata.cloudProjectId,
        libraryPath: metadata.libraryPath,
        libraryType: metadata.libraryType,
      }
      return current.projectIORefSignal.peek()
    },
    openFile: async (path, options = {}) => {
      const router = ctx.services.get(routerService)
      const location = router.getLocation()
      const target = joinRouterPaths(
        PATHS.FILE,
        safeEncodeForRouterPaths(path),
        options.subRoute ?? ''
      )
      const settings = ctx.services.optional(settingsService)?.get()
      if (
        settings &&
        !shouldNavigateToRequestedPath({
          currentPathname: location.pathname,
          onboardingStatus: settings.app.onboardingStatus.current,
          requestedPath: target,
        })
      )
        return
      const current = project.peek()
      const editor = current?.executingEditor.peek()
      const lsp = ctx.services.optional(lspService)
      lsp?.onFileClose(editor?.path ?? null, current?.path ?? null)
      lsp?.onFileOpen(
        path,
        options.projectPath ?? current?.path ?? fsZds.dirname(path)
      )
      ctx.services
        .optional(engineConnectionService)
        ?.manager.rejectAllModelingCommands(EXECUTE_AST_INTERRUPT_ERROR_MESSAGE)
      if (editor) {
        if (editor.path && editor.path !== path) editor.switchedFiles = true
        editor.isExecuting = false
      }
      const params = new URLSearchParams(location.search)
      params.delete(ASK_TO_OPEN_QUERY_PARAM)
      if (options.clearProjectId) params.delete(PROJECT_ID_QUERY_PARAM)
      const search = params.toString()
      await router.navigate(target + (search ? `?${search}` : ''), {
        replace: target.includes(String(PATHS.ONBOARDING)),
      })
    },
    rename: async (source, destination) => {
      if (source === destination) return
      const current = project.peek()
      const editor = current?.executingEditor.peek()
      const editorPath = editor?.path
      const affected =
        editor &&
        (editor.path === source ||
          editor.path.startsWith(`${source}${fsZds.sep}`))
      if (
        affected &&
        !(await editor.flushWriteToFile({ suppressConflictToast: true }))
      )
        return Promise.reject(
          new ExpectedFileOperationError(
            'File has unsaved changes that could not be written. Rename canceled.'
          )
        )
      await flushActiveTextFileWrite()
      const operations = ctx.services.get(fileOperationsService)
      const metadata = current?.projectIORefSignal.peek()
      const entrypointRelative = metadata
        ? getContainedRelativePath(
            { relative: fsZds.relative, sep: fsZds.sep },
            source,
            metadata.default_file
          )
        : undefined
      const nextEntrypoint =
        entrypointRelative !== undefined
          ? fsZds.join(destination, entrypointRelative)
          : undefined
      const tomlPath = current
        ? fsZds.join(current.path, PROJECT_SETTINGS_FILE_NAME)
        : undefined
      const nextToml =
        nextEntrypoint && current && tomlPath
          ? setProjectDefaultFileInProjectTomlContents(
              await readTextFile(operations, tomlPath),
              fsZds.relative(current.path, nextEntrypoint)
            )
          : undefined
      const rename = async (operations: FileOperationsRegistryService) => {
        await operations
          .rename(source, destination)
          .catch((error: unknown) =>
            Promise.reject(
              error instanceof FileAlreadyExists
                ? new ExpectedFileOperationError('Name already exists.')
                : error
            )
          )
        // Rebind immediately after the move, even if persisting metadata fails.
        if (
          affected &&
          editor &&
          project.peek() === current &&
          current?.executingEditor.peek() === editor &&
          editor.path === editorPath
        ) {
          editor.path = fsZds.join(
            destination,
            fsZds.relative(source, editor.path)
          )
        }
        const path = current?.executingPathSignal.peek()
        if (
          project.peek() === current &&
          path &&
          (path.peek() === source ||
            path.peek().startsWith(`${source}${fsZds.sep}`))
        )
          path.value = fsZds.join(
            destination,
            fsZds.relative(source, path.peek())
          )
        if (nextEntrypoint && current && project.peek() === current) {
          current.projectIORefSignal.value = {
            ...current.projectIORefSignal.peek(),
            default_file: nextEntrypoint,
          }
        }
        if (nextToml !== undefined && tomlPath)
          await operations.writeFile(tomlPath, nextToml)
      }
      const cloud = ctx.services.optional(cloudStorageService)
      if (cloud && source.startsWith(`${cloud.root}${fsZds.sep}`))
        await cloud.batch(source, rename)
      else await rename(operations)
    },
    project,
    executingEditor,
    currentProjectLibraryId,
    getProject: () => project.value,
    setProject: (nextProject) => {
      project.value = nextProject
    },
    clearProject: () => {
      project.value = undefined
    },
    getCurrentProjectLibraryId: () => currentProjectLibraryId.value,
    setCurrentProjectLibraryId: (libraryId) => {
      currentProjectLibraryId.value = libraryId
    },
  }

  const cloudService = ctx.services.signal(cloudStorageService)
  let disposed = false
  const resumeCloudSaves = async () => {
    const current = project.peek()
    const cloud = cloudService.peek()
    const id = current?.projectIORefSignal.peek().cloudProjectId
    if (disposed || isOffline() || !current || !cloud || !id) return
    // Retry the staged snapshot first: a failed acknowledgement can leave the
    // storage buffer equal to the editor even though saving is not confirmed.
    await cloud.retry(id)
    if (disposed || isOffline() || project.peek() !== current) return
    await current.executingEditor.peek()?.flushWriteToFile()
    if (disposed || isOffline() || project.peek() !== current) return
    await flushActiveTextFileWrite()
  }
  const onOnline = () => {
    void resumeCloudSaves().catch(reportRejection)
  }
  window.addEventListener('online', onOnline)
  let stopReconciliation: (() => void) | undefined
  queueMicrotask(() => {
    if (disposed) return
    stopReconciliation = effect(() =>
      cloudService.value?.subscribeReconciled?.((root, files) => {
        const current = project.peek()
        if (!current || current.path !== root) return
        adoptCloudTextSnapshot(
          root,
          new Map(
            files.map((file) => [
              fsZds.join(root, file.relativePath),
              file.data,
            ])
          )
        )
        const editor = current.executingEditor.peek()
        const file = files.find(
          (file) => fsZds.join(root, file.relativePath) === editor?.path
        )
        editor?.adoptCloudSnapshot(
          root,
          file ? new TextDecoder().decode(file.data) : undefined
        )
        // A new snapshot invalidates older metadata reads, while metadata scans
        // must leave the snapshot rebuild running.
        refreshGeneration += 1
        const generation = ++reconciliationGeneration
        const isCurrent = () =>
          project.peek() === current && reconciliationGeneration === generation
        void current
          .reloadFilesFromStorage(isCurrent)
          .then(async () => {
            if (!isCurrent()) return
            if (!file) {
              const target = current.projectIORefSignal.peek().default_file
              if (target) await serviceImpl.openFile(target)
              else await ctx.services.get(routerService).navigate(PATHS.HOME)
            }
          })
          .catch(reportRejection)
      })
    )
  })

  return {
    id: 'project-session-extension',
    providesServices: [provideService(projectSession, serviceImpl)],
    dispose: () => {
      disposed = true
      window.removeEventListener('online', onOnline)
      stopReconciliation?.()
      for (const stop of cloudWatchers.values()) stop()
      cloudWatchers.clear()
    },
  }
}, 'project-session-extension')

export default defineRegistryItem({
  id: 'project-session',
  uses: [projectSessionExtension],
})
