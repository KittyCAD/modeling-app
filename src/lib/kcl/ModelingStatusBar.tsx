import { useSignals } from '@preact/signals-react/runtime'
import { StatusBarFrame } from '@src/components/StatusBar/StatusBar'
import type { ModelingViewContext } from '@src/lib/kcl/registry/contract'
import { boundSceneCommands } from '@src/lib/kcl/viewCommands'
import { resolveToCodeRef } from '@src/lang/queryAst'
import { engineTopologyFallbackFromReference } from '@src/lib/selections'
import { DEFAULT_DEFAULT_LENGTH_UNIT } from '@src/lib/constants'
import { SceneToolsProvider } from '@src/registry/extensions/engineScene/sceneToolsHost'
import { Suspense, useMemo } from 'react'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { ArtifactGraph } from '@src/lang/wasm'
const emptyGraph: ArtifactGraph = new Map()
const emptySelection: Selections = { graphSelections: [], otherSelections: [] }

/** A status contribution always receives the view whose footer contains it. */
export function ModelingStatusBar({
  context,
}: {
  context: ModelingViewContext
}) {
  useSignals()
  const scene = context.session.resource.value
  const model = scene?.selection.model.value ?? null
  const output = context.executor.output.value
  const selected = scene?.selection.displayed.value
  const graph = scene?.runtime.state.value.artifactGraph ?? emptyGraph
  const selections = useMemo<Selections>(
    () =>
      selected
        ? {
            graphSelections: selected.map(({ reference }) => ({
              entityRef: reference,
              ...resolveToCodeRef({ entityRef: reference }, graph),
              engineTopologyFallback:
                engineTopologyFallbackFromReference(reference),
            })),
            otherSelections: [],
          }
        : emptySelection,
    [selected, graph]
  )
  const sendModelingCommand = useMemo(
    () =>
      boundSceneCommands(context, scene, model, {
        contents: output.contents,
        src: output.src,
      }),
    [context, scene, model, output.contents, output.src]
  )
  const executing = output.running || (scene?.runtime.executing.value ?? false)
  const idle = !!model && !executing && !output.errors['kcl.execution']
  const unit =
    scene?.runtime.fileSettings.value.defaultLengthUnit ??
    scene?.preferences.defaultUnit.value ??
    DEFAULT_DEFAULT_LENGTH_UNIT
  const items = context.statusItems.value.toSorted((a, b) => a.order - b.order)
  return (
    <SceneToolsProvider
      host={{
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
      }}
    >
      <StatusBarFrame
        label="Modeling view status"
        className="flex-wrap b-3 bg-2 text-2"
      >
        {(['start', 'end'] as const).map((side) => (
          <div
            key={side}
            className="flex min-w-0 flex-wrap items-stretch"
            data-status-side={side}
          >
            {items
              .filter((item) => item.side === side)
              .map(({ id, Component }) => (
                <Suspense key={id} fallback={null}>
                  <Component context={context} />
                </Suspense>
              ))}
          </div>
        ))}
      </StatusBarFrame>
    </SceneToolsProvider>
  )
}
