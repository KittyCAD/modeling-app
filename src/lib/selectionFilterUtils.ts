/**
 * Utility functions for managing selection filters in the engine.
 * Extracted to avoid circular dependencies between KclSingleton and selections.
 */

import type { EntityType, ModelingCmdReq } from '@kittycad/lib'
import type { ConnectionManager } from '@src/network/connectionManager'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { handleSelectionBatch } from '@src/lib/selections'
import { uuidv4 } from '@src/lib/utils'
import type { KclManager } from '@src/lang/KclManager'
import type { SceneEntities } from '@src/clientSideScene/sceneEntities'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export const defaultSelectionFilter: EntityType[] = [
  'face',
  'edge',
  'solid2d',
  'curve',
  'object',
]

/** TODO: This function is not synchronous but is currently treated as such */
export function setSelectionFilterToDefault({
  engineCommandManager,
  kclManager,
  sceneEntitiesManager,
  selectionsToRestore,
  handleSelectionBatchFn,
  wasmInstance,
}: {
  engineCommandManager: ConnectionManager
  kclManager: KclManager
  sceneEntitiesManager: SceneEntities
  selectionsToRestore?: Selections
  handleSelectionBatchFn?: typeof handleSelectionBatch
  wasmInstance: ModuleType
}) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  setSelectionFilter({
    filter: defaultSelectionFilter,
    engineCommandManager,
    kclManager,
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
  kclManager,
  sceneEntitiesManager,
  selectionsToRestore,
  handleSelectionBatchFn,
  wasmInstance,
}: {
  filter: EntityType[]
  engineCommandManager: ConnectionManager
  kclManager: KclManager
  sceneEntitiesManager: SceneEntities
  selectionsToRestore?: Selections
  handleSelectionBatchFn?: typeof handleSelectionBatch
  wasmInstance: ModuleType
}) {
  const { engineEvents } =
    selectionsToRestore && handleSelectionBatchFn
      ? handleSelectionBatchFn({
          selections: selectionsToRestore,
          artifactGraph: kclManager.artifactGraph,
          code: kclManager.code,
          ast: kclManager.ast,
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
  engineEvents.forEach((event) => {
    if (event.type === 'modeling_cmd_req') {
      modelingCmd.push({
        cmd_id: uuidv4(),
        cmd: event.cmd,
      })
    }
  })

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
