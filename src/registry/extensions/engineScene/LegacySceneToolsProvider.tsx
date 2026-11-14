import { useSignals } from '@preact/signals-react/runtime'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { DEFAULT_DEFAULT_LENGTH_UNIT } from '@src/lib/constants'
import { uuidv4 } from '@src/lib/utils'
import { useCallback, type ReactNode } from 'react'
import type { ModelingCmd } from '@kittycad/lib'
import { SceneToolsProvider } from './sceneToolsHost'
import { measurementToolService } from './measurementToolService'
import { physicalAnalysisService } from './physicalAnalysis/physicalAnalysisService'
import type { ArtifactGraph } from '@src/lang/wasm'
import type { Selections } from '@src/machines/modelingSharedTypes'
const emptyGraph: ArtifactGraph = new Map()
const emptySelections: Selections = { graphSelections: [], otherSelections: [] }

/** Adapt the legacy modeling machine once; tool views consume only the explicit host. */
export function LegacySceneToolsProvider({
  children,
}: {
  children: ReactNode
}) {
  useSignals()
  const { state } = useModelingContext()
  const { engineCommandManager, kclManager, store } = state.context
  const executing = kclManager.isExecutingSignal?.value ?? false
  const graph = kclManager.artifactGraph ?? emptyGraph
  const sendModelingCommand = useCallback(
    (cmd: ModelingCmd) =>
      engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd,
      }),
    [engineCommandManager]
  )
  return (
    <SceneToolsProvider
      host={{
        selections: state.context.selectionRanges ?? emptySelections,
        artifactGraph: graph,
        idle: state.matches('idle'),
        executing,
        unit:
          kclManager.fileSettings.defaultLengthUnit ??
          store.defaultUnit?.current ??
          DEFAULT_DEFAULT_LENGTH_UNIT,
        executionKey: 'legacy',
        sendModelingCommand,
        container: document.getElementById('stream'),
        measurement: measurementToolService,
        physicalAnalysis: physicalAnalysisService,
      }}
    >
      {children}
    </SceneToolsProvider>
  )
}
