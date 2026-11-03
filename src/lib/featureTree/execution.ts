import type { Diagnostic } from '@codemirror/lint'
import type { ArtifactGraph, OperationsByModule } from '@src/lang/wasm'

/** Execution-owned inputs; independent of the editor implementation and mounted views. */
export interface FeatureTreeExecution {
  operations: OperationsByModule
  completedOperations: OperationsByModule
  artifactGraph: ArtifactGraph
  failedOperations: readonly OperationsByModule[]
  diagnostics: readonly Diagnostic[]
  hasParseErrors: boolean
  lastSuccessfulOperations: OperationsByModule
  lastSuccessfulCode: string
  liveActiveModuleId: number | null
  liveLatestOperationKey: string | null
}

/** Empty editors expose an empty snapshot instead of data from the previous file. */
export function emptyFeatureTreeExecution(): FeatureTreeExecution {
  return {
    operations: { map: {} },
    completedOperations: { map: {} },
    artifactGraph: new Map(),
    failedOperations: [],
    diagnostics: [],
    hasParseErrors: false,
    lastSuccessfulOperations: { map: {} },
    lastSuccessfulCode: '',
    liveActiveModuleId: null,
    liveLatestOperationKey: null,
  }
}
