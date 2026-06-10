/**
 * Utility functions for managing selection filters in the engine.
 * Extracted to avoid circular dependencies between KclSingleton and selections.
 */

import type { EntityType, ModelingCmdReq } from '@kittycad/lib'
import type { SceneEntities } from '@src/clientSideScene/sceneEntities'
import type { ExecutingEditor } from '@src/lang/ExecutingEditor'
import type { handleSelectionBatch } from '@src/lib/selections'
import { uuidv4 } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { ConnectionManager } from '@src/network/connectionManager'

export const defaultSelectionFilter: EntityType[] = [
  'face',
  'edge',
  'solid2d',
  'curve',
  'object',
  'path',
]

/** TODO: This function is not synchronous but is currently treated as such */
export function setSelectionFilterToDefault({
  engineCommandManager,
  executingEditor,
  sceneEntitiesManager,
  selectionsToRestore,
  handleSelectionBatchFn,
  wasmInstance,
}: {
  engineCommandManager: ConnectionManager
  executingEditor: ExecutingEditor
  sceneEntitiesManager: SceneEntities
  selectionsToRestore?: Selections
  handleSelectionBatchFn?: typeof handleSelectionBatch
  wasmInstance: ModuleType
}) {
  setSelectionFilter({
    filter: defaultSelectionFilter,
    engineCommandManager,
    executingEditor,
    sceneEntitiesManager,
    selectionsToRestore,
    handleSelectionBatchFn,
    wasmInstance,
  })
}

/** TODO: This function is not synchronous but is currently treated as such */
export function setSelectionFilter({
  filter,
  engineCommandManager,
  executingEditor,
  sceneEntitiesManager,
  selectionsToRestore,
  handleSelectionBatchFn,
  wasmInstance,
}: {
  filter: EntityType[]
  engineCommandManager: ConnectionManager
  executingEditor: ExecutingEditor
  sceneEntitiesManager: SceneEntities
  selectionsToRestore?: Selections
  handleSelectionBatchFn?: typeof handleSelectionBatch
  wasmInstance: ModuleType
}) {
  executingEditor.selectionFilter.value = filter

  const { engineEvents } =
    selectionsToRestore && handleSelectionBatchFn
      ? handleSelectionBatchFn({
          selections: selectionsToRestore,
          artifactGraph: executingEditor.artifactGraph,
          code: executingEditor.code,
          ast: executingEditor.ast,
          systemDeps: {
            sceneEntitiesManager,
            engineCommandManager,
            wasmInstance,
          },
        })
      : { engineEvents: undefined }

  if (!selectionsToRestore || !engineEvents) {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'set_selection_filter',
        filter,
      },
    })
    return
  }

  const modelingCmd: ModelingCmdReq[] = []
  for (const event of engineEvents) {
    if (event.type === 'modeling_cmd_req') {
      modelingCmd.push({
        cmd_id: uuidv4(),
        cmd: event.cmd,
      })
    }
  }

  // batch is needed other wise the selection flickers.
  engineCommandManager
    .sendSceneCommand({
      type: 'modeling_cmd_batch_req',
      batch_id: uuidv4(),
      requests: [
        {
          cmd_id: uuidv4(),
          cmd: {
            type: 'set_selection_filter',
            filter,
          },
        },
        ...modelingCmd,
      ],
      responses: false,
    })
    .catch((error) => console.error('Failed to set selection filter:', error))
}

/** Clear the engine scene selection */
export async function clearSceneSelection(
  engineCommandManager: ConnectionManager
) {
  await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd: {
      type: 'select_clear',
    },
    cmd_id: uuidv4(),
  })
}
