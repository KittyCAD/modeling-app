import fsZds from '@src/lib/fs-zds'
import { getProjectInfo } from '@src/lib/desktop'
import {
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
import { flushActiveTextFileWrite } from '@src/lib/activeTextFile'
import {
  defineRegistryItem,
  defineRegistryItemFactory,
  provideService,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals-core'
import type { ZDSProject } from '@src/lib/projectSession'
import {
  createTextFileIO,
  type TextFileIO,
} from '@src/lib/projectSession/textFileIO'
import {
  type FileOperationsRegistryService,
  fileOperationsService,
} from '@src/registry/contracts/fileOperations'
import {
  projectSession,
  type ProjectSessionService,
} from '@src/registry/contracts/projectSession'

export const projectSessionExtension = defineRegistryItemFactory((ctx) => {
  const project = signal<ZDSProject | undefined>(undefined)
  let refreshGeneration = 0
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

  const serviceImpl: ProjectSessionService = {
    get textFileIO() {
      return (textFileIO ??= createTextFileIO(
        ctx.services.get(fileOperationsService),
        {
          watch: (path, key, onEvent) =>
            electron?.watchFileOn(path, key, onEvent),
          unwatch: (path, key) => electron?.watchFileOff(path, key),
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
        await wasm
      )
      if (project.peek() !== current || refreshGeneration !== generation) return
      current.projectIORefSignal.value = {
        ...refreshed,
        cloudProjectId: refreshed.cloudProjectId ?? metadata.cloudProjectId,
        libraryPath: metadata.libraryPath,
        libraryType: metadata.libraryType,
      }
      return current.projectIORefSignal.peek()
    },
    // TODO: Separate route navigation from the session's file-switch lifecycle.
    // The route layer should own onboarding and URL/query parameters; the session
    // should own language-server document changes and engine cancellation. Keep
    // them coordinated here until then so navigation cannot leave diagnostics or
    // modeling commands attached to the previous file.
    openFile: async (path, options = {}) => {
      const router = ctx.services.get(routerService)
      const location = router.getLocation()
      const target = joinRouterPaths(
        PATHS.FILE,
        safeEncodeForRouterPaths(path),
        options.subRoute ?? ''
      )
      const settings = ctx.services.optional(settingsService)?.get()
      const isStaleOnboardingNavigation = Boolean(
        settings &&
          !shouldNavigateToRequestedPath({
            currentPathname: location.pathname,
            onboardingStatus: settings.app.onboardingStatus.current,
            requestedPath: target,
          })
      )
      if (isStaleOnboardingNavigation) return
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
      if (await operations.exists(destination))
        return Promise.reject(
          new ExpectedFileOperationError('Name already exists.')
        )
      const rename = async (operations: FileOperationsRegistryService) => {
        await operations.rename(source, destination)
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
      }
      await rename(operations)
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

  return {
    id: 'project-session-extension',
    providesServices: [provideService(projectSession, serviceImpl)],
  }
}, 'project-session-extension')

export default defineRegistryItem({
  id: 'project-session',
  uses: [projectSessionExtension],
})
