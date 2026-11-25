import type { QueryEntityTypeWithPoint } from '@kittycad/lib'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import { getNormalisedCoordinates, isArray, uuidv4 } from '@src/lib/utils'

/** Shared point-query path: ConnectionManager delegates to local GPU picking when installed. */
export async function sendQueryEntityTypeWithPointFromSceneClick(
  event: Pick<MouseEvent, 'clientX' | 'clientY'>,
  element: Pick<HTMLElement, 'getBoundingClientRect'>,
  commands: Pick<ConnectionManager, 'sendSceneCommand' | 'streamDimensions'>
): Promise<QueryEntityTypeWithPoint | undefined> {
  const bounds = element.getBoundingClientRect()
  if (bounds.width <= 0 || bounds.height <= 0) return undefined
  const response = await commands.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'query_entity_type_with_point',
      selected_at_window: getNormalisedCoordinates(
        event,
        element,
        commands.streamDimensions
      ),
      selection_type: 'add',
    },
  })
  const single = isArray(response) ? response[0] : response
  if (!single || !isModelingResponse(single)) return undefined
  const result = single.resp.data.modeling_response
  return result.type === 'query_entity_type_with_point'
    ? result.data
    : undefined
}
