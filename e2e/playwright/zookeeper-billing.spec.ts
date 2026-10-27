import { token } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import type { CustomerBalance, MlCopilotServerMessage } from '@kittycad/lib'
import { decode } from '@msgpack/msgpack'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

// API CI provisions a disposable account; ordinary app CI must not drain its
// shared account. This tag is selected explicitly, without the usual @web tag.
const BILLING_REPLY_MARKER =
  'ZOO_MAGIC_STRING_TRIGGER_BILLING_REPLY_AF604B8C3F47506D7C07CAD2B1C5D18FB9406D5EF19C26EDD4A5F862C769BCA3'

test.describe('Live Zookeeper billing', { tag: '@billing-live' }, () => {
  test.skip(
    process.env.E2E_ZOOKEEPER_BILLING !== '1',
    'Requires the disposable account provisioned by API CI'
  )

  test('exhausts credits on an existing socket and preserves the completed edit', async ({
    page,
    request,
    homePage,
    scene,
    toolbar,
    copilot,
    editor,
  }) => {
    const apiBaseUrl = process.env.VITE_ZOO_API_BASE_URL
    expect(apiBaseUrl, 'API CI must select the API under test').toBeTruthy()
    expect(token, 'API CI must supply the disposable user token').toBeTruthy()
    const balanceUrl = `${apiBaseUrl}/user/payment/balance`
    const headers = { Authorization: `Bearer ${token}` }
    const initial = await request.get(balanceUrl, { headers })
    expect(initial.ok()).toBe(true)
    const initialBalance = (await initial.json()) as CustomerBalance
    expect(
      initialBalance.monthly_api_credits_remaining_monetary_value +
        initialBalance.stable_api_credits_remaining_monetary_value
    ).toBe(0.01)

    let connectionCount = 0
    const requests: string[] = []
    const responses: MlCopilotServerMessage[] = []
    page.on('websocket', (socket) => {
      if (new URL(socket.url()).pathname !== '/ws/ml/copilot') {
        return
      }
      connectionCount += 1
      socket.on('framesent', ({ payload }) => {
        const message =
          typeof payload === 'string' ? JSON.parse(payload) : decode(payload)
        if (message.type === 'user') {
          requests.push(message.content)
        }
      })
      socket.on('framereceived', ({ payload }) => {
        responses.push(
          (typeof payload === 'string'
            ? JSON.parse(payload)
            : decode(payload)) as MlCopilotServerMessage
        )
      })
    })
    await page.reload()
    await page.setBodyDimensions({ width: 1500, height: 1000 })
    await homePage.goToModelingScene()
    await scene.settled()
    await toolbar.openPane(DefaultLayoutPaneID.Code)
    await toolbar.openPane(DefaultLayoutPaneID.Zookeeper)
    await copilot.conversationInput.fill(
      `Create the canned cube [${BILLING_REPLY_MARKER}]`
    )
    await copilot.submitButton.click()
    await expect(copilot.placeHolderResponse).toBeVisible()
    await expect.poll(() => requests.length).toBe(1)
    expect(connectionCount).toBe(1)

    const queuedPrompt = 'Keep this follow-up queued until credits are restored'
    await copilot.conversationInput.fill(queuedPrompt)
    await copilot.submitButton.click()
    await expect(
      page.getByRole('button', { name: 'Remove queued message 1' })
    ).toBeVisible()

    await expect(
      page.getByText("You're out of Zookeeper credits.")
    ).toBeVisible({
      timeout: 30_000,
    })
    await expect(
      page.getByRole('link', { name: 'Manage billing' })
    ).toBeVisible()
    await expect(copilot.submitButton).toBeDisabled()
    await expect(page.getByText(queuedPrompt, { exact: true })).toBeVisible()
    await expect(editor.codeContent).toContainText('cube = extrude', {
      timeout: 30_000,
    })

    // A frontend-only balance check cannot satisfy this: API must send the
    // typed denial after the completed response, on the original connection.
    const endIndex = responses.findIndex(
      (message) => 'end_of_stream' in message
    )
    const denialIndex = responses.findIndex(
      (message) => 'access_denied' in message
    )
    expect(endIndex).toBeGreaterThanOrEqual(0)
    expect(denialIndex).toBeGreaterThan(endIndex)
    expect(responses[denialIndex]).toMatchObject({
      access_denied: { code: 'pay_as_you_go_disabled', retryable: false },
    })
    expect(connectionCount).toBe(1)
    expect(requests).toHaveLength(1)

    const exhausted = await request.get(balanceUrl, { headers })
    expect(exhausted.ok()).toBe(true)
    const finalBalance = (await exhausted.json()) as CustomerBalance
    expect(
      finalBalance.monthly_api_credits_remaining_monetary_value +
        finalBalance.stable_api_credits_remaining_monetary_value
    ).toBe(0)
  })
})
