import {
  defineContract,
  defineService,
  firstWinsValueSpec,
} from '@kittycad/registry'
import type { Signal } from '@preact/signals-core'
import type { KclManager, ZDSProject } from '@src/lang/KclManager'
import type { App } from '@src/lib/app'

export interface OpenedProjectHandle {
  projectPath: string
}

export interface ExecutingEditorHandle {
  projectPath: string
  filePath: string
}

export interface OpenEditorOptions {
  providedEditor?: KclManager
  providedCode?: string
  isExecuting?: boolean
}

export interface ProjectRouteHandlesOptions {
  routeId?: string
  requestUrl: string
  usesHashRouter?: boolean
}

export interface ProjectRouteHandlesResult {
  redirectTo?: string
}

export interface ProjectSessionService {
  readonly openedProjectHandle: Signal<OpenedProjectHandle | undefined>
  readonly executingEditorHandle: Signal<ExecutingEditorHandle | undefined>
  readonly openedProject: Signal<ZDSProject | undefined>
  bindApp(app: App): void
  setOpenedProjectHandle(
    handle: OpenedProjectHandle | undefined
  ): Promise<ZDSProject | undefined>
  setExecutingEditorHandle(
    handle: ExecutingEditorHandle | undefined,
    options?: OpenEditorOptions
  ): Promise<KclManager | undefined>
  setProjectRouteHandles(
    options: ProjectRouteHandlesOptions
  ): Promise<ProjectRouteHandlesResult>
}

export const projectSessionContract = defineContract({
  openedProjectHandleValueSpec: firstWinsValueSpec<
    OpenedProjectHandle | undefined
  >('opened-project-handle', undefined),
  executingEditorHandleValueSpec: firstWinsValueSpec<
    ExecutingEditorHandle | undefined
  >('executing-editor-handle', undefined),
  openedProjectValueSpec: firstWinsValueSpec<ZDSProject | undefined>(
    'opened-project',
    undefined
  ),
  projectSessionService:
    defineService<ProjectSessionService>('project-session'),
})

export const {
  openedProjectHandleValueSpec,
  executingEditorHandleValueSpec,
  openedProjectValueSpec,
  projectSessionService,
} = projectSessionContract
