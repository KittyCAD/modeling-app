import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { KclManager } from '@src/lang/KclManager'

export interface ExecutingEditorUpdateOptions {
  shouldExecute?: boolean
  shouldResetCamera?: boolean
  shouldWriteToDisk?: boolean
  shouldAddToHistory?: boolean
  shouldClearHistory?: boolean
}

export interface ExecutingEditorService {
  readonly editor: ReadonlySignal<KclManager | undefined>
  readonly code: ReadonlySignal<string>
  readonly hasEditsSinceLastExecution: ReadonlySignal<boolean>
  readonly isExecuting: ReadonlySignal<boolean>
  readonly executionElapsedMs: ReadonlySignal<number>
  readonly selectionStatusLabel: ReadonlySignal<string>
  readonly showExperimentalFeaturesStatusBarItem: ReadonlySignal<boolean>
  getPendingCommandCount(): number
  executeCode(code?: string): Promise<void>
  updateCode(code: string, options?: ExecutingEditorUpdateOptions): void
}

export const executingEditorContract = defineContract({
  executingEditorService:
    defineService<ExecutingEditorService>('executing-editor'),
})

export const { executingEditorService } = executingEditorContract
