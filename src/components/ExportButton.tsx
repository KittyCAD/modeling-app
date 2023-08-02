import { useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useStore } from '../useStore'

export const ExportButton = () => {
  const cmdId = useRef('')
  const { engineCommandManager } = useStore((s) => ({
    engineCommandManager: s.engineCommandManager,
  }))

  const file_id = uuidv4()

  const handleClick = async () => {
    engineCommandManager?.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd: {
        type: 'export',
        entity_ids: [],
        format: {
          // TODO: support other formats.
          type: 'step',
          coords: {
            forward: {
              axis: 'y',
              direction: 'negative',
            },
            up: {
              axis: 'z',
              direction: 'positive',
            },
          },
        },
      },
      cmd_id: uuidv4(),
      file_id: file_id,
    })
  }

  return <button onClick={() => handleClick()}>Export</button>
}
