import type { Diagnostic } from '@codemirror/lint'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import type { Artifact } from '@src/lang/std/artifactGraph'
import type { ArtifactGraph } from '@src/lang/wasm'
import { getBodiesFromArtifactGraph } from '@src/lang/std/artifactGraph'
import {
  countOperations,
  emptyOperationsByModule,
  getAllOperations,
  ROOT_MODULE_ID,
} from '@src/lang/wasm'
import {
  buildOperationTree,
  type OperationTreeNode,
} from '@src/lib/featureTree/featureTreeOperationTree'
import type { FeatureTreeExecution } from '@src/lib/featureTree/execution'
import {
  getHideOpByArtifactId,
  type HideOperation,
} from '@src/lib/operationVisibility'

/** Stable body identity, including individual copies that share a pattern artifact. */
export interface FeatureTreeBody {
  id: string
  label: string
  artifact: Artifact & { type: 'compositeSolid' | 'sweep' | 'pattern' }
  artifactGraph: ArtifactGraph
  hideOperation?: HideOperation
  engineEntityId?: string
  patternIndex?: number
}

/** One derived snapshot shared by the layout panes and the Scene browser. */
export interface FeatureTreeModel {
  operations: OperationTreeNode[]
  code: string
  visibilityOperations: Operation[]
  bodies: readonly FeatureTreeBody[]
  diagnostics: readonly Diagnostic[]
  hasParseErrors: boolean
  disabledForUnrenderedChanges: boolean
  readOnly: boolean
  showingStaleTree: boolean
  isExecuting: boolean
  liveActiveModuleId: number | null
  liveLatestOperationKey: string | null
}

export function buildFeatureTreeState(
  source: FeatureTreeExecution | undefined,
  code: string,
  isExecuting: boolean,
  disabledForUnrenderedChanges: boolean
): FeatureTreeModel {
  const failedOperations =
    source?.failedOperations.reduce(
      (longest, operations) =>
        countOperations(operations) > countOperations(longest)
          ? operations
          : longest,
      emptyOperationsByModule()
    ) ?? emptyOperationsByModule()
  const hasParseErrors = source?.hasParseErrors ?? false
  const operations = buildOperationTree(
    !source
      ? emptyOperationsByModule()
      : isExecuting
        ? source.operations
        : hasParseErrors
          ? source.lastSuccessfulOperations
          : source.failedOperations.length
            ? failedOperations
            : source.operations,
    ROOT_MODULE_ID
  )
  const visibilityOperations = source ? getAllOperations(source.operations) : []
  const completedOperations = source
    ? getAllOperations(source.completedOperations)
    : []
  const bodies: FeatureTreeBody[] = []
  if (source)
    for (const [id, artifact] of getBodiesFromArtifactGraph(
      source.artifactGraph
    )) {
      const patternIndex =
        artifact.type === 'pattern'
          ? Math.max(0, artifact.copyIds.indexOf(id) + 1)
          : undefined
      const hideOperation =
        getHideOpByArtifactId(completedOperations, id) ??
        (artifact.type === 'pattern' && patternIndex === 0
          ? getHideOpByArtifactId(completedOperations, artifact.sourceId)
          : undefined)
      bodies.push({
        id,
        artifact,
        artifactGraph: source.artifactGraph,
        label: `Body ${bodies.length + 1}`,
        hideOperation,
        engineEntityId: artifact.type === 'pattern' ? id : undefined,
        patternIndex,
      })
    }
  return {
    operations,
    code:
      hasParseErrors || disabledForUnrenderedChanges
        ? source?.lastSuccessfulCode || code
        : code,
    visibilityOperations,
    bodies,
    diagnostics: source?.diagnostics ?? [],
    hasParseErrors,
    disabledForUnrenderedChanges,
    readOnly: hasParseErrors || disabledForUnrenderedChanges,
    showingStaleTree: hasParseErrors && operations.length > 0,
    isExecuting,
    liveActiveModuleId: source?.liveActiveModuleId ?? null,
    liveLatestOperationKey: source?.liveLatestOperationKey ?? null,
  }
}
