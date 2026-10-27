// Delete with the streamed-renderer compatibility suite after the rollout ends.
import type { Page } from '@playwright/test'
import {
  doAndWaitForImageDiff,
  sendSceneCommand,
} from '@e2e/playwright/test-utils'
import { uuidv4 } from '@src/lib/utils'

export async function moveStreamCameraTo(
  page: Page,
  pos: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }
) {
  await doAndWaitForImageDiff(
    page,
    () =>
      sendSceneCommand(page, {
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'default_camera_look_at',
          vantage: pos,
          center: target,
          up: { x: 0, y: 0, z: 1 },
        },
      }),
    300
  )
}
