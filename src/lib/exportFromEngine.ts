import { engineCommandManager } from 'lib/singletons'
import { type Models } from '@kittycad/lib'
import { v4 as uuidv4 } from 'uuid'

// Isolating a function to call the engine to export the current scene.
// Because it has given us trouble in automated testing environments.
export function exportFromEngine({
  format,
}: {
  format: Models['OutputFormat_type']
}) {
  return engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd: {
      type: 'export',
      // By default let's leave this blank to export the whole scene.
      // In the future we might want to let the user choose which entities
      // in the scene to export. In that case, you'd pass the IDs thru here.
      entity_ids: [],
      format,
    },
    cmd_id: uuidv4(),
  })
}
