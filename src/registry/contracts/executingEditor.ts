import type { ReadonlySignal } from '@preact/signals-core'
import { defineContract, defineService } from '@kittycad/registry'

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
  executeCode(code?: string): Promise<void>
  updateCode(code: string, options?: ExecutingEditorUpdateOptions): void
}

export const executingEditorContract = defineContract({
  executingEditorService:
    defineService<ExecutingEditorService>('executing-editor'),
})

export const { executingEditorService } = executingEditorContract
