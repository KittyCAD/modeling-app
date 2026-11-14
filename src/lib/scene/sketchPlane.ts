import type { GetSketchModePlane } from '@kittycad/lib'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import { isArray, uuidv4 } from '@src/lib/utils'

/** Resolve the existing streamed/local sketch-plane protocol and always release its temporary engine mode. */
export async function getSketchPlaneDetails(
  commands: Pick<ConnectionManager, 'sendSceneCommand'>,
  entityId: string
): Promise<GetSketchModePlane> {
  try {
    await commands.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'enable_sketch_mode',
        adjust_camera: false,
        animated: false,
        ortho: false,
        entity_id: entityId,
      },
    })
    const response = await commands.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: { type: 'get_sketch_mode_plane' },
    })
    const single = isArray(response) ? response[0] : response
    const result =
      single && isModelingResponse(single)
        ? single.resp.data.modeling_response
        : undefined
    if (result?.type !== 'get_sketch_mode_plane')
      return Promise.reject(
        new Error(
          'Unable to resolve the selected sketch plane. Select a planar face or plane.'
        )
      )
    return result.data
  } finally {
    await commands.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: { type: 'sketch_mode_disable' },
    })
  }
}
