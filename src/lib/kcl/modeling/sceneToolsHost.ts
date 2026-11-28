import type { ModelingViewContext } from '@src/lib/kcl/registry/contract'
import type { SceneToolsHost } from '@src/registry/extensions/engineScene/sceneToolsHost'
import { boundSceneCommands } from '@src/lib/kcl/modeling/viewCommands'
import { resolveToCodeRef } from '@src/lang/queryAst'
import { engineTopologyFallbackFromReference } from '@src/lib/selections'
import { DEFAULT_DEFAULT_LENGTH_UNIT } from '@src/lib/constants'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { ArtifactGraph } from '@src/lang/wasm'
const emptyGraph: ArtifactGraph = new Map()

/** Supplies shared status controls with geometry and services from their owning view. */
export function viewSceneToolsHost(
  context: ModelingViewContext
): SceneToolsHost {
  const scene = context.session.resource.value
  const model = scene?.selection.model.value ?? null
  const selected = context.selection.items.value
  const graph = scene?.runtime.state.value.artifactGraph ?? emptyGraph
  const selections: Selections = {
    graphSelections: selected.flatMap((item) =>
      item.kind === 'model'
        ? [
            {
              entityRef: item.value.reference,
              ...resolveToCodeRef({ entityRef: item.value.reference }, graph),
              engineTopologyFallback: engineTopologyFallbackFromReference(
                item.value.reference
              ),
            },
          ]
        : []
    ),
    otherSelections: selected.flatMap((item) =>
      item.kind === 'engine-primitive' ? [item.selection] : []
    ),
  }
  const sendModelingCommand = boundSceneCommands(context, scene, model)
  const executing = scene?.runtime.executing.value ?? false
  const idle =
    !!model &&
    !context.interactions.active.value &&
    !executing &&
    !scene?.runtime.failed.value
  const unit =
    scene?.runtime.fileSettings.value.defaultLengthUnit ??
    scene?.preferences.defaultUnit.value ??
    DEFAULT_DEFAULT_LENGTH_UNIT
  return {
    selections,
    artifactGraph: graph,
    idle,
    executing,
    unit,
    executionKey: String(scene?.runtime.executionRevision.value ?? 0),
    sendModelingCommand,
    container: scene?.element ?? null,
    measurement: context.measurement,
    physicalAnalysis: context.physicalAnalysis,
  }
}
