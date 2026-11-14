import { effect } from '@preact/signals-core'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import type { KclRuntime } from '@src/lib/kcl/runtime'
import { SceneExecutionEvents } from '@src/lib/kcl/scene/execution'
import { createSceneSelection } from '@src/lib/scene/selection'
import {
  sceneSelectionAdapter,
  attachSceneSelectionInput,
} from '@src/lib/scene/selectionAdapter'
import { defaultSelectionFilter } from '@src/lib/selectionFilterUtils'

/** Bind shared picking to one runtime; execution invalidates geometry IDs and successful completion supplies a new target. */
export function createKclSceneSelection(
  manager: ConnectionManager,
  sceneInfra: SceneInfra,
  model: KclRuntime
) {
  const sceneId = Symbol('scene')
  const selection = createSceneSelection(
    sceneSelectionAdapter(manager, sceneInfra.renderer.domElement),
    defaultSelectionFilter
  )
  const stopInput = attachSceneSelectionInput(
    sceneInfra.renderer.domElement,
    sceneInfra.camControls,
    selection
  )
  const stopExecuting = effect(() => {
    if (model.executing.value) selection.invalidate()
  })
  const executionDone = (event: Event) => {
    const detail = (event as CustomEvent<{ successful: boolean }>).detail
    if (!model.executing.peek() && detail.successful && !model.failed.peek())
      selection.setModel({ sceneId, executionId: Symbol('execution') })
    else selection.invalidate()
  }
  model.events.addEventListener(
    SceneExecutionEvents.ExecutionDone,
    executionDone
  )
  return {
    selection,
    dispose: () => {
      stopInput()
      stopExecuting()
      model.events.removeEventListener(
        SceneExecutionEvents.ExecutionDone,
        executionDone
      )
      selection.dispose()
    },
  }
}
