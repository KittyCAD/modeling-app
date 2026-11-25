/** Scene presentations observe execution without acquiring the editor's KCL manager. */
export enum SceneExecutionEvents {
  FileChanged = 'file-changed',
  LongExecution = 'long-execution',
  ExecutionDone = 'execution-done',
}

export interface SceneExecutionDoneDetail {
  successful: boolean
  isInterrupted: boolean
  hasErrors: boolean
}
