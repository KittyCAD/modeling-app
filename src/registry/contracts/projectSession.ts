import {
  defineContract,
  defineService,
  firstWinsValueSpec,
} from '@kittycad/registry'
import type { Signal } from '@preact/signals-core'
import type { KclManager, ZDSProject } from '@src/lang/KclManager'
import type { App } from '@src/lib/app'
import type { Project } from '@src/lib/project'

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

export interface OpenProjectEditorInput extends OpenEditorOptions {
  project: Project
  filePath: string
}

export interface ProjectSessionService {
  readonly openedProjectHandle: Signal<OpenedProjectHandle | undefined>
  readonly executingEditorHandle: Signal<ExecutingEditorHandle | undefined>
  readonly openedProject: Signal<ZDSProject | undefined>
  bindApp(app: App): void
  openProject(project: Project): Promise<ZDSProject>
  openEditor(filePath: string, options?: OpenEditorOptions): Promise<KclManager>
  openProjectEditor(input: OpenProjectEditorInput): Promise<{
    project: ZDSProject
    editor: KclManager
  }>
  closeProject(): void
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
