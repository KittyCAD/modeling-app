import { effect } from '@preact/signals-core'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import type { KclRuntime } from '@src/lib/kcl/execution/runtime'
import { SceneExecutionEvents } from '@src/lib/kcl/scene/execution'
import { createSceneSelection } from '@src/lib/kcl/scene/selection'
import {
  sceneSelectionAdapter,
  attachSceneSelectionInput,
} from '@src/lib/kcl/scene/selectionAdapter'
import { isRecord } from '@src/lib/utils'
import { defaultSelectionFilter } from '@src/lib/selectionFilterUtils'

/**
 * Creates selection for one KCL scene. Picks use this scene's connection and
 * input canvas; execution signals and events from `model` determine when that
 * geometry can be selected. The returned `dispose` removes the input and runtime
 * listeners and releases the selection controller when the scene closes.
 */
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
  // Stop using references as soon as execution starts. `invalidate` clears the
  // view selection and dialog fields and prevents pending picks from updating them.
  const stopExecuting = effect(() => {
    if (model.executing.value) selection.invalidate()
  })
  const executionDone = (event: Event) => {
    if (!(event instanceof CustomEvent)) return
    const detail: unknown = event.detail
    if (!isRecord(detail) || typeof detail.successful !== 'boolean') return
    // `createKclRuntime` emits `ExecutionDone` after clearing `executing`.
    // A successful result gets a fresh identity so earlier references remain
    // invalid even when native execution reused cached geometry.
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
