import { mockClientErrorReports, token } from '@e2e/playwright/test-utils'
import { expect, test } from '@playwright/test'
import {
  IS_PLAYWRIGHT_KEY,
  TOKEN_PERSIST_KEY,
  VERCEL_PLAYWRIGHT_TOKEN_QUERY_PARAM,
} from '@src/lib/constants'
import { UNSUPPORTED_ENGINE_VIDEO_CODEC_MESSAGE } from '@src/lib/engineConnection/videoCodecSupport'

test.skip(
  Boolean(process.env.CI) && process.platform === 'linux',
  'GPU-less Linux CI cannot boot the WebGL app in Firefox; macOS and Windows retain this coverage.'
)

test(
  'Firefox without H.264 stops before Engine allocation',
  { tag: '@web' },
  async ({ context, page }) => {
    const offeredVideoCodecs = await page.evaluate(async () => {
      const peerConnection = new RTCPeerConnection()
      try {
        peerConnection.addTransceiver('video', { direction: 'recvonly' })
        const offer = await peerConnection.createOffer()
        return (offer.sdp ?? '')
          .split(/\r?\n/)
          .filter((line) => /^a=rtpmap:\d+\s+/i.test(line))
      } finally {
        peerConnection.close()
      }
    })
    expect(offeredVideoCodecs).toContainEqual(expect.stringMatching(/\sVP8\//i))
    expect(offeredVideoCodecs).not.toContainEqual(
      expect.stringMatching(/\sH264\//i)
    )

    const engineWebSockets: string[] = []
    page.on('websocket', (webSocket) => {
      if (webSocket.url().includes('/ws/modeling/commands')) {
        engineWebSockets.push(webSocket.url())
      }
    })

    await context.route('**/user/features', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ features: [] }),
      })
    })
    await mockClientErrorReports(context)
    await context.addInitScript(
      ({ isPlaywrightKey, persistedToken, tokenPersistKey }) => {
        localStorage.setItem(isPlaywrightKey, 'true')
        localStorage.setItem(tokenPersistKey, persistedToken)
      },
      {
        isPlaywrightKey: IS_PLAYWRIGHT_KEY,
        persistedToken: token,
        tokenPersistKey: TOKEN_PERSIST_KEY,
      }
    )

    const vercelBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
    if (vercelBypassSecret) {
      await page.route('**/*', async (route, request) => {
        if (new URL(request.url()).hostname.endsWith('vercel.dev.zoo.dev')) {
          await route.fallback({
            headers: {
              ...request.headers(),
              'X-Vercel-Protection-Bypass': vercelBypassSecret,
            },
          })
          return
        }
        await route.fallback()
      })
    }

    const url =
      process.env.VERCEL_BASE_URL && token
        ? `/?${VERCEL_PLAYWRIGHT_TOKEN_QUERY_PARAM}=${token}`
        : '/'
    await page.goto(url)

    await expect(
      page.getByRole('heading', { name: 'Unsupported video codec' })
    ).toBeVisible()
    await expect(page.getByRole('alert')).toContainText(
      UNSUPPORTED_ENGINE_VIDEO_CODEC_MESSAGE
    )
    await expect
      .poll(() =>
        page.evaluate(() => ({
          hasConnection: Boolean(window.engineCommandManager.connection),
          started: window.engineCommandManager.started,
        }))
      )
      .toEqual({ hasConnection: false, started: false })
    expect(engineWebSockets).toEqual([])
  }
)
