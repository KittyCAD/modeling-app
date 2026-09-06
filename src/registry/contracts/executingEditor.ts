import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'

export interface ExecutingEditorUpdateOptions {
  shouldExecute?: boolean
  shouldResetCamera?: boolean
  shouldWriteToDisk?: boolean
  shouldAddToHistory?: boolean
  shouldClearHistory?: boolean
}

export interface ExecutingEditorService {
  readonly code: ReadonlySignal<string>
  readonly hasEditsSinceLastExecution: ReadonlySignal<boolean>
  readonly isExecuting: ReadonlySignal<boolean>
  /** Null before the first execution; retains the final duration afterward. */
  readonly executionElapsedMs: ReadonlySignal<number | null>
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
