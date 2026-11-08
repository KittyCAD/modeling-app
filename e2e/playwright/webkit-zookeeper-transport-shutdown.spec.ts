import { createHash } from 'node:crypto'
import { once } from 'node:events'
import http from 'node:http'
import type { Socket } from 'node:net'
import { expect, test as zooTest } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

// Worker lifetime keeps the mock alive until AFTER browser-context teardown.
// No backend messages are needed: these probes never submit a prompt.
const test = zooTest.extend<
  object,
  { shutdownMockServer: { origin: string; connections: number } }
>({
  shutdownMockServer: [
    async ({}, use) => {
      const mock = { origin: '', connections: 0 }
      const sockets = new Set<Socket>()
      const server = http.createServer((_, response) => response.end())
      server.on('connection', (socket) => {
        sockets.add(socket)
        socket.on('close', () => sockets.delete(socket))
        socket.on('error', () => {})
      })
      server.on('upgrade', (request, socket) => {
        mock.connections++
        const accept = createHash('sha1')
          .update(
            request.headers['sec-websocket-key'] +
              '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
          )
          .digest('base64')
        socket.write(
          'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
            accept +
            '\r\n\r\n'
        )
        socket.on('data', (frame: Buffer) => {
          if ((frame[0] & 0x0f) === 8) socket.end(Buffer.from([0x88, 0x00]))
        })
      })
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string')
        throw new Error('Local mock did not bind a TCP port')
      try {
        mock.origin = `ws://127.0.0.1:${address.port}`
        await use(mock)
      } finally {
        for (const socket of sockets) socket.destroy()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    },
    { scope: 'worker' },
  ],
})

test.describe(
  'Zookeeper transport shutdown comparison',
  { tag: ['@web', '@zookeeper'] },
  () => {
    test.skip(
      process.env.PLAYWRIGHT_WEBKIT_TEARDOWN_DIAGNOSTICS !== '1',
      'Only run with the temporary shutdown observer'
    )
    for (const backend of ['local', 'real'] as const) {
      for (const intercepted of [false, true]) {
        test(`${backend} socket, ${intercepted ? 'intercepted' : 'direct'}`, async ({
          page,
          homePage,
          scene,
          toolbar,
          copilot,
          shutdownMockServer,
        }) => {
          const mockConnectionsBefore = shutdownMockServer.connections
          let interceptedConnections = 0
          if (intercepted) {
            await page.routeWebSocket('**/ws/ml/copilot**', (client) => {
              interceptedConnections++
              const server = client.connectToServer()
              server.onMessage((message) => client.send(message))
            })
          }
          // Same setup in all four cells, including the original test's reload.
          await page.reload()
          await page.setBodyDimensions({ width: 1500, height: 1000 })
          // Redirect only the copilot constructor, preserving the app's panel
          // initialization. Strip the real URL and its authentication query.
          // The existing diagnostic constructor underneath still observes it.
          await page.evaluate(
            (origin) => {
              if (!origin) return
              window.WebSocket = new Proxy(window.WebSocket, {
                construct(target, args, newTarget) {
                  if (
                    new URL(String(args[0]), location.href).pathname.includes(
                      '/ws/ml/copilot'
                    )
                  ) {
                    args[0] = `${origin}/ws/ml/copilot`
                  }
                  return Reflect.construct(target, args, newTarget)
                },
              })
            },
            backend === 'local' ? shutdownMockServer.origin : null
          )
          await homePage.goToModelingScene()
          await scene.settled()
          await toolbar.closePane(DefaultLayoutPaneID.Code)
          await toolbar.openPane(DefaultLayoutPaneID.Zookeeper)
          await expect(copilot.conversationInput).toBeVisible()
          await expect
            .poll(
              () =>
                page.evaluate(() => {
                  const observer = Reflect.get(
                    window,
                    '__webkitResourceDiagnostics'
                  ) as {
                    snapshot: () => {
                      sockets: { role: string; readyState?: number }[]
                    }
                  }
                  return observer
                    .snapshot()
                    .sockets.some(
                      (socket) =>
                        socket.role === 'copilot' &&
                        socket.readyState === WebSocket.OPEN
                    )
                }),
              { timeout: 30_000 }
            )
            .toBe(true)
          expect(interceptedConnections).toBe(intercepted ? 1 : 0)
          expect(shutdownMockServer.connections - mockConnectionsBefore).toBe(
            backend === 'local' ? 1 : 0
          )
          await expect(page.getByTestId('ml-request-chat-bubble')).toHaveCount(
            0
          )
        })
      }
    }
  }
)
