import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

// Temporary application-stage comparison for the shutdown diagnostics branch.
test.describe('WebKit application shutdown probes', { tag: '@web' }, () => {
  test.skip(
    process.env.PLAYWRIGHT_WEBKIT_TEARDOWN_DIAGNOSTICS !== '1',
    'Only run with the temporary shutdown observer'
  )

  test('home page without opening a project', async ({ page, homePage }) => {
    await expect(page).toHaveURL(/\/home(?:[/?#]|$)/)
    await homePage.projectsLoaded()
    await expect(page.getByTestId('stream')).toHaveCount(0)
  })

  test('project with an established engine stream', async ({
    homePage,
    scene,
    toolbar,
  }) => {
    await homePage.goToModelingScene()
    await scene.settled()
    await expect(scene.streamWrapper).toBeVisible()
    await expect(toolbar.startSketchBtn).toBeEnabled()
  })

  for (const submitPrompt of [false, true]) {
    test(
      submitPrompt
        ? 'Zookeeper canned prompt with response held'
        : 'Zookeeper panel open without submitting a prompt',
      { tag: '@zookeeper' },
      async ({ page, homePage, scene, toolbar, copilot }) => {
        let connections = 0
        let responses = 0
        let holdResponses = false
        await page.routeWebSocket('**/ws/ml/copilot**', (client) => {
          connections++
          const server = client.connectToServer()
          server.onMessage((message) => {
            responses++
            if (!holdResponses) client.send(message)
          })
        })
        // Match the original Zookeeper test's navigation and layout setup.
        await page.reload()
        await page.setBodyDimensions({ width: 1500, height: 1000 })
        await homePage.goToModelingScene()
        await scene.settled()
        await toolbar.closePane(DefaultLayoutPaneID.Code)
        await toolbar.openPane(DefaultLayoutPaneID.Zookeeper)
        await expect(copilot.conversationInput).toBeVisible()
        await expect.poll(() => connections).toBe(1)

        if (submitPrompt) {
          // Same backend bypass as zookeeper.spec.ts. Hold the reply so this
          // stage isolates submission from code application and chat clearing.
          const marker =
            'ZOO_MAGIC_STRING_TRIGGER_MOCK_REPLY_D39D279C6F84FA63AD49364FDEFB4A27D0E15BA7FB0975D4D6E003A8A594E460'
          await copilot.conversationInput.fill(
            `This is a test prompt [${marker}]`
          )
          const responsesBeforeSubmit = responses
          holdResponses = true
          await copilot.submitButton.click()
          await expect(copilot.placeHolderResponse).toBeVisible()
          await expect
            .poll(() => responses, { timeout: 30_000 })
            .toBeGreaterThan(responsesBeforeSubmit)
          await expect(page.getByTestId('ml-request-chat-bubble')).toHaveCount(
            1
          )
        } else {
          await expect(page.getByTestId('ml-request-chat-bubble')).toHaveCount(
            0
          )
        }
      }
    )
  }
})
