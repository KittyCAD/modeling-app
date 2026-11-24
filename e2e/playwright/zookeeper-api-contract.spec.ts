import { existsSync } from 'node:fs'

import { CopilotFixture } from '@e2e/playwright/fixtures/copilotFixture'
import { ToolbarFixture } from '@e2e/playwright/fixtures/toolbarFixture'
import { setup } from '@e2e/playwright/test-utils'
import { expect, test } from '@playwright/test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

type ContractSocket = WebSocket & { isZookeeperContractSocket?: boolean }

type ContractWindow = Window &
  typeof globalThis & {
    zookeeperContractSockets?: ContractSocket[]
  }

const contractWebSocketUrl = process.env.ZOOKEEPER_CONTRACT_WEBSOCKET_URL
const contractApiToken = process.env.ZOOKEEPER_CONTRACT_API_TOKEN
const exhaustedFile = process.env.ZOOKEEPER_CONTRACT_EXHAUSTED_FILE

test.describe(
  'Zookeeper API consumer contract',
  { tag: '@api-contract' },
  () => {
    test.skip(
      !contractWebSocketUrl || !contractApiToken || !exhaustedFile,
      'The API contract harness supplies the candidate URL, token, and billing signal.'
    )

    test('shows billing recovery without retrying a non-retryable denial', async ({
      page,
      context,
    }, testInfo) => {
      if (!contractWebSocketUrl || !contractApiToken || !exhaustedFile) {
        throw new Error('Missing Zookeeper API contract configuration')
      }
      await page.setViewportSize({ width: 1500, height: 1000 })
      await setup(context, page, testInfo)

      await page.addInitScript(
        ({ websocketUrl, apiToken }) => {
          const contractWindow = window as ContractWindow
          const NativeWebSocket = window.WebSocket
          contractWindow.zookeeperContractSockets = []

          class ZookeeperContractWebSocket extends NativeWebSocket {
            isZookeeperContractSocket = false

            constructor(url: string | URL, protocols?: string | string[]) {
              super(url, protocols)
              this.isZookeeperContractSocket =
                String(url).split('?')[0] === websocketUrl.split('?')[0]
              if (this.isZookeeperContractSocket) {
                contractWindow.zookeeperContractSockets?.push(this)
              }
            }

            override send(data: string | Blob | BufferSource) {
              let outgoing = data
              if (this.isZookeeperContractSocket && typeof data === 'string') {
                try {
                  const message = JSON.parse(data) as {
                    headers?: Record<string, string>
                  }
                  if (message.headers?.Authorization) {
                    message.headers.Authorization = `Bearer ${apiToken}`
                    outgoing = JSON.stringify(message)
                  }
                } catch {
                  // Non-JSON messages should pass through unchanged.
                }
              }
              NativeWebSocket.prototype.send.call(this, outgoing)
            }
          }

          window.WebSocket = ZookeeperContractWebSocket
        },
        {
          websocketUrl: contractWebSocketUrl,
          apiToken: contractApiToken,
        }
      )

      await page.goto('/')
      const toolbar = new ToolbarFixture(page)
      const copilot = new CopilotFixture(page)
      await expect(toolbar.locator).toBeVisible({ timeout: 30_000 })
      await toolbar.closePane(DefaultLayoutPaneID.Code)
      await toolbar.openPane(DefaultLayoutPaneID.Zookeeper)

      const onboardingInvite = page.getByTestId('onboarding-toast')
      if (await onboardingInvite.isVisible()) {
        await page.getByTestId('onboarding-not-right-now').click()
        await expect(onboardingInvite).not.toBeVisible()
      }

      const prompt = 'Complete my final credited Zookeeper prompt.'
      await copilot.conversationInput.fill(prompt)
      await copilot.submitButton.click()
      await expect(page.getByTestId('ml-request-chat-bubble')).toContainText(
        prompt
      )
      await expect(copilot.placeHolderResponse).not.toBeVisible({
        timeout: 30_000,
      })

      await expect
        .poll(() => existsSync(exhaustedFile), { timeout: 30_000 })
        .toBe(true)

      await page.evaluate(() => {
        const sockets =
          (window as ContractWindow).zookeeperContractSockets ?? []
        const activeSocket = sockets.find(
          (socket) => socket.readyState === WebSocket.OPEN
        )
        if (!activeSocket) {
          throw new Error('No open Zookeeper contract socket')
        }
        activeSocket.close()
      })

      const outOfCreditsBanner = page.getByRole('alert').filter({
        hasText: "You're out of Zookeeper credits.",
      })
      await expect(outOfCreditsBanner).toHaveClass(/border-ml-green/, {
        timeout: 30_000,
      })
      await expect(outOfCreditsBanner).toContainText(
        "You're out of Zookeeper credits."
      )
      await expect(outOfCreditsBanner).toContainText('Enable pay as you go')
      await expect(
        outOfCreditsBanner.getByRole('link', { name: 'Manage billing' })
      ).toBeVisible()
      await expect(
        outOfCreditsBanner.getByRole('button', { name: 'Check again' })
      ).toBeVisible()
      await expect(
        page.getByText('Zookeeper disconnected unexpectedly.')
      ).not.toBeVisible()

      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                (window as ContractWindow).zookeeperContractSockets?.length ?? 0
            ),
          { timeout: 5_000 }
        )
        .toBe(2)
      await page.waitForTimeout(3_500)
      expect(
        await page.evaluate(
          () => (window as ContractWindow).zookeeperContractSockets?.length ?? 0
        )
      ).toBe(2)
    })
  }
)
