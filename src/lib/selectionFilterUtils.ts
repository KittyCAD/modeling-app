/**
 * Utility functions for managing selection filters in the engine.
 * Extracted to avoid circular dependencies between KclSingleton and selections.
 */

import type { EntityType, ModelingCmdReq } from '@kittycad/lib'
import type { ConnectionManager } from '@src/network/connectionManager'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { handleSelectionBatch } from '@src/lib/selections'
import { uuidv4 } from '@src/lib/utils'

export const defaultSelectionFilter: EntityType[] = [
  'face',
  'edge',
  'solid2d',
  'curve',
  'object',
]

/** TODO: This function is not synchronous but is currently treated as such */
export function setSelectionFilterToDefault(
  engineCommandManager: ConnectionManager,
  selectionsToRestore?: Selections,
  handleSelectionBatchFn?: typeof handleSelectionBatch
) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  setSelectionFilter(
    defaultSelectionFilter,
    engineCommandManager,
    selectionsToRestore,
    handleSelectionBatchFn
  )
}

/** TODO: This function is not synchronous but is currently treated as such */
export function setSelectionFilter(
  filter: EntityType[],
  engineCommandManager: ConnectionManager,
  selectionsToRestore?: Selections,
  handleSelectionBatchFn?: typeof handleSelectionBatch
) {
  const { engineEvents } =
    selectionsToRestore && handleSelectionBatchFn
      ? handleSelectionBatchFn({
          selections: selectionsToRestore,
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
