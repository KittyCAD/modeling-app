import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

// See zookeeper/text_to_cad/zookeeper_magic_bypass.py
const ZK_MOCK_REPLY_MARKER =
  'ZOO_MAGIC_STRING_TRIGGER_MOCK_REPLY_D39D279C6F84FA63AD49364FDEFB4A27D0E15BA7FB0975D4D6E003A8A594E460'
const ZOOKEEPER_TEST_TAGS = ['@desktop', '@web', '@zookeeper']

test.describe('Zookeeper tests', { tag: ZOOKEEPER_TEST_TAGS }, () => {
  test('Happy path: new project, easy prompt, good result', async ({
    page,
    editor,
    homePage,
    scene,
    toolbar,
    copilot,
  }) => {
    let holdResponses = false
    let zookeeperConnectionCount = 0
    let releaseResponses: () => void = () => {
      throw new Error('Zookeeper WebSocket was not intercepted')
    }
    await page.routeWebSocket('**/ws/ml/copilot**', (client) => {
      zookeeperConnectionCount += 1
      const bufferedMessages: Parameters<typeof client.send>[0][] = []
      const server = client.connectToServer()
      server.onMessage((message) => {
        if (holdResponses) {
          bufferedMessages.push(message)
          return
        }
        client.send(message)
      })
      releaseResponses = () => {
        for (const message of bufferedMessages.splice(0)) {
          client.send(message)
        }
      }
    })
    await page.reload()
    await page.setBodyDimensions({ width: 1500, height: 1000 })
    await homePage.goToModelingScene()
    await scene.settled()

    await test.step('Submit basic prompt', async () => {
      const prompt = `make a 10x10x10cm cube centered on the origin, name the last variable "cube" [${ZK_MOCK_REPLY_MARKER}]`

      await toolbar.closePane(DefaultLayoutPaneID.Code)
      await toolbar.openPane(DefaultLayoutPaneID.Zookeeper)
      await copilot.setMode('fast')
      await copilot.conversationInput.fill(prompt)
      expect(zookeeperConnectionCount).toBe(1)
      holdResponses = true
      await copilot.submitButton.click()
      await expect(page.getByTestId('ml-request-chat-bubble')).toContainText(
        prompt
      )
      await expect(copilot.placeHolderResponse).toBeVisible()

      const zookeeperPaneButton = page.getByTestId(
        `${DefaultLayoutPaneID.Zookeeper}-pane-button`
      )
      await toolbar.closePane(DefaultLayoutPaneID.Zookeeper)
      await expect(
        zookeeperPaneButton.locator('svg[aria-label="loading"]')
      ).toBeVisible()
      expect(zookeeperConnectionCount).toBe(1)
      holdResponses = false
      releaseResponses()
      await expect(
        zookeeperPaneButton.locator('svg[aria-label="sparkles"]')
      ).toBeVisible({ timeout: 30_000 })
      expect(zookeeperConnectionCount).toBe(1)

      await toolbar.openPane(DefaultLayoutPaneID.Code)
      await expect(editor.codeContent).toContainText('sketch', {
        timeout: 30_000,
      })
      await scene.settled()
      expect(zookeeperConnectionCount).toBe(1)

      await toolbar.openPane(DefaultLayoutPaneID.Zookeeper)
      await expect(copilot.conversationInput).toBeVisible()
      await expect(copilot.placeHolderResponse).not.toBeVisible({
        timeout: 30_000,
      })
      expect(zookeeperConnectionCount).toBe(1)
      await expect(page.getByTestId('ml-response-chat-bubble')).toBeVisible()
      await toolbar.closePane(DefaultLayoutPaneID.Zookeeper)

      await toolbar.closePane(DefaultLayoutPaneID.Code)
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      await scene.settled()
      const extrude = await toolbar.getFeatureTreeOperation('cube', 0)
      await expect(extrude).toBeVisible()
    })
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
