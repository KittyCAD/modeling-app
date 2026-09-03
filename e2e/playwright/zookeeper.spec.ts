import { expect, test } from '@e2e/playwright/zoo-test'
import type { Page } from '@playwright/test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

// See zookeeper/text_to_cad/zookeeper_magic_bypass.py
const ZK_MOCK_REPLY_MARKER =
  'ZOO_MAGIC_STRING_TRIGGER_MOCK_REPLY_D39D279C6F84FA63AD49364FDEFB4A27D0E15BA7FB0975D4D6E003A8A594E460'
const ZOOKEEPER_TEST_TAGS = ['@desktop', '@web', '@zookeeper']
const ZOOKEEPER_SESSION_KEY = '__zookeeperSessionBeforePaneClose'

async function rememberZookeeperSession(page: Page) {
  await page.evaluate((key) => {
    const actor = window.app.debug.zookeeperManagerActor
    const webSocket = actor?.getSnapshot().context.ws
    if (!actor || webSocket?.readyState !== WebSocket.OPEN) {
      throw new Error('Expected a connected Zookeeper session')
    }
    Reflect.set(window, key, [actor, webSocket])
  }, ZOOKEEPER_SESSION_KEY)
}

async function expectZookeeperSessionUnchanged(page: Page) {
  expect(
    await page.evaluate((key) => {
      const actor = window.app.debug.zookeeperManagerActor
      const webSocket = actor?.getSnapshot().context.ws
      const before = Reflect.get(window, key)
      return (
        actor === before?.[0] &&
        webSocket === before?.[1] &&
        webSocket?.readyState === WebSocket.OPEN
      )
    }, ZOOKEEPER_SESSION_KEY)
  ).toBe(true)
}

test.describe('Zookeeper tests', { tag: ZOOKEEPER_TEST_TAGS }, () => {
  test('Happy path: new project, easy prompt, good result', async ({
    page,
    editor,
    homePage,
    scene,
    toolbar,
    copilot,
  }) => {
    await page.setBodyDimensions({ width: 1500, height: 1000 })
    await homePage.goToModelingScene()
    await scene.settled()

    await test.step('Submit basic prompt', async () => {
      const prompt = `make a 10x10x10cm cube centered on the origin, name the last variable "cube" [${ZK_MOCK_REPLY_MARKER}]`

      await toolbar.closePane(DefaultLayoutPaneID.Code)
      await toolbar.openPane(DefaultLayoutPaneID.Zookeeper)
      await copilot.setMode('fast')
      await copilot.conversationInput.fill(prompt)
      await copilot.submitButton.click()
      await expect(page.getByTestId('ml-request-chat-bubble')).toContainText(
        prompt
      )
      await expect(copilot.placeHolderResponse).not.toBeVisible({
        timeout: 30_000,
      })
      await rememberZookeeperSession(page)

      await toolbar.closePane(DefaultLayoutPaneID.Zookeeper)
      await page.waitForTimeout(250)
      await toolbar.openPane(DefaultLayoutPaneID.Zookeeper)
      await expect(copilot.conversationInput).toBeVisible()
      await expectZookeeperSessionUnchanged(page)
      expect(
        await page.getByTestId('ml-response-chat-bubble').isVisible()
      ).toBe(true)
      await toolbar.openPane(DefaultLayoutPaneID.Code)
      await expect(editor.codeContent).toContainText('sketch', {
        timeout: 30_000,
      })
      await scene.settled()
      await expectZookeeperSessionUnchanged(page)
      await toolbar.closePane(DefaultLayoutPaneID.Zookeeper)

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

    await rememberZookeeperSession(page)

    await toolbar.closePane(DefaultLayoutPaneID.Zookeeper)
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        })
    )

    await expectZookeeperSessionUnchanged(page)

    await toolbar.openPane(DefaultLayoutPaneID.Zookeeper)
    await expectZookeeperSessionUnchanged(page)
  })
  test(
    'Chat history can be cleared',
    { tag: ['@desktop', '@web'] },
    async ({ page, homePage, scene, toolbar, copilot }) => {
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
