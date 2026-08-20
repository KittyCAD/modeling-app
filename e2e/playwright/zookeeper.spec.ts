import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

// See zookeeper/text_to_cad/zookeeper_magic_bypass.py
const ZK_MOCK_REPLY_MARKER =
  'ZOO_MAGIC_STRING_TRIGGER_MOCK_REPLY_D39D279C6F84FA63AD49364FDEFB4A27D0E15BA7FB0975D4D6E003A8A594E460'

test.describe('Zookeeper tests', { tag: ['@desktop', '@web'] }, () => {
  test('Happy path: new project, easy prompt, good result', async ({
    page,
    editor,
    homePage,
    scene,
    toolbar,
    cmdBar,
    copilot,
  }) => {
    await page.setBodyDimensions({ width: 1500, height: 1000 })
    await homePage.goToModelingScene()
    await scene.settled()

    await test.step('Submit basic prompt', async () => {
      await toolbar.closePane(DefaultLayoutPaneID.Code)
      await toolbar.openPane(DefaultLayoutPaneID.Zookeeper)
      await copilot.setMode('fast')
      await copilot.conversationInput.fill(
        `make a 10x10x10cm cube centered on the origin, name the last variable "cube" [${ZK_MOCK_REPLY_MARKER}]`
      )
      await copilot.submitButton.click()
      await expect(copilot.placeHolderResponse).toBeVisible()
      await expect(copilot.placeHolderResponse).not.toBeVisible({
        timeout: 30_000,
      })

      await toolbar.closePane(DefaultLayoutPaneID.Zookeeper)
      await toolbar.openPane(DefaultLayoutPaneID.Code)
      await expect(editor.codeContent).toContainText('sketch')

      await toolbar.closePane(DefaultLayoutPaneID.Code)
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      await scene.settled()
      const extrude = await toolbar.getFeatureTreeOperation('cube', 0)
      await expect(extrude).toBeVisible()
    })
  })
  test('Closing and reopening the pane keeps the Zookeeper session alive', async ({
    page,
    homePage,
    scene,
    toolbar,
  }) => {
    await page.setBodyDimensions({ width: 1500, height: 1000 })
    await homePage.goToModelingScene()
    await scene.settled()
    await toolbar.openPane(DefaultLayoutPaneID.Zookeeper)

    await page.waitForFunction(
      () => {
        const actor = window.app.debug.zookeeperManagerActor
        const snapshot = actor?.getSnapshot()
        return (
          snapshot?.matches('ready' as never) === true &&
          snapshot.context.ws?.readyState === WebSocket.OPEN
        )
      },
      undefined,
      { timeout: 60_000 }
    )

    await page.evaluate(() => {
      const actor = window.app.debug.zookeeperManagerActor
      const websocket = actor?.getSnapshot().context.ws
      if (!actor || !websocket) {
        throw new Error('Expected a ready Zookeeper session')
      }
      Reflect.set(window, '__zookeeperSessionBeforePaneClose', {
        actor,
        websocket,
      })
    })

    await toolbar.closePane(DefaultLayoutPaneID.Zookeeper)
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        })
    )

    const sessionIsUnchanged = () =>
      page.evaluate(() => {
        const before = Reflect.get(window, '__zookeeperSessionBeforePaneClose')
        const actor = window.app.debug.zookeeperManagerActor
        return (
          actor === before?.actor &&
          actor?.getSnapshot().context.ws === before?.websocket &&
          before?.websocket.readyState === WebSocket.OPEN
        )
      })

    expect(await sessionIsUnchanged()).toBe(true)

    await toolbar.openPane(DefaultLayoutPaneID.Zookeeper)
    expect(await sessionIsUnchanged()).toBe(true)
    await page.evaluate(() => {
      Reflect.deleteProperty(window, '__zookeeperSessionBeforePaneClose')
    })
  })
  test(
    'Chat history can be cleared',
    { tag: ['@desktop', '@web'] },
    async ({ page, homePage, scene, toolbar, cmdBar, copilot }) => {
      await page.setBodyDimensions({ width: 1500, height: 1000 })
      await homePage.goToModelingScene()
      await scene.settled()

      await test.step('Submit placeholder prompt', async () => {
        await toolbar.closePane(DefaultLayoutPaneID.Code)
        await toolbar.openPane(DefaultLayoutPaneID.Zookeeper)
        await copilot.conversationInput.fill(
          `This is a test prompt [${ZK_MOCK_REPLY_MARKER}]`
        )
        await copilot.submitButton.click()
        await expect(copilot.placeHolderResponse).toBeVisible()
      })

      await test.step('Clear the chat history', async () => {
        await copilot.clearChatButton.click()
        await expect(copilot.welcomeSection).not.toBeVisible()
        await expect(copilot.welcomeSection).toBeVisible({ timeout: 30_000 })

        await expect(page.getByTestId('ml-request-chat-bubble')).toHaveCount(0)
        await expect(page.getByTestId('ml-response-chat-bubble')).toHaveCount(0)
        await expect(copilot.clearChatButton).not.toBeVisible()
      })
    }
  )
})
