import { prepareModeling } from '@e2e/performance/scenarios'
import { expect, test } from '@e2e/playwright/zoo-test'

test.use({ mockApiRoutes: false })

test(
  'performance setup waits for the usable model after an initial engine disconnect',
  { tag: '@desktop' },
  async ({ page, homePage, scene, fs, folderSetupFn }) => {
    // Interrupt the real initial execution. The app owns reconnecting; setup
    // must wait for its usable model, not mistake a transient error for idle.
    const preparing = prepareModeling({
      page,
      homePage,
      scene,
      fs,
      folderSetupFn,
      modelProfile: 'large',
    }).then(
      () => ({ error: undefined }),
      (error: unknown) => ({ error })
    )
    await page.waitForFunction(() => {
      const editor = window.app?.project?.executingEditor.value
      return (
        editor?.isExecutingSignal.value &&
        editor.engineCommandManager.connection?.websocket?.readyState ===
          WebSocket.OPEN
      )
    })
    await page.evaluate(() => {
      const socket =
        window.app?.project?.executingEditor.value?.engineCommandManager
          .connection?.websocket
      if (socket?.readyState !== WebSocket.OPEN) {
        throw new Error('The initial execution needs a real open engine socket')
      }
      socket.close(1000, 'initial model setup reconnect regression')
    })
    const result = await preparing
    expect(result.error).toBeUndefined()
    await expect(scene.startEditSketchBtn).toBeEnabled()
  }
)
