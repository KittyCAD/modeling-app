// Delete with the streamed-renderer compatibility suite after the rollout ends.
import { SceneFixture } from '@e2e/playwright/fixtures/sceneFixture'
import {
  doAndWaitForImageDiff,
  sendSceneCommand,
} from '@e2e/playwright/test-utils'
import { expect, test as baseTest } from '@e2e/playwright/zoo-test'
import { uuidv4 } from '@src/lib/utils'

class StreamSceneFixture extends SceneFixture {
  override moveCameraTo = async (
    pos: { x: number; y: number; z: number },
    target: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }
  ) => {
    await doAndWaitForImageDiff(
      this.page,
      () =>
        sendSceneCommand(this.page, {
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
}

const test = baseTest.extend({
  scene: async ({ page }, provide) => {
    await provide(new StreamSceneFixture(page, false))
  },
})
export { expect, test }
