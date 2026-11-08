import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

// Observe the same real socket in every case; only half close it explicitly.
test.describe(
  'Zookeeper explicit socket close comparison',
  { tag: ['@web', '@zookeeper'] },
  () => {
    test.skip(
      process.env.PLAYWRIGHT_WEBKIT_TEARDOWN_DIAGNOSTICS !== '1',
      'Only run with the temporary shutdown observer'
    )
    for (const intercepted of [false, true]) {
      for (const explicitClose of [false, true]) {
        test(`${intercepted ? 'intercepted' : 'direct'}, ${explicitClose ? 'await socket close' : 'normal teardown'}`, async ({
          page,
          homePage,
          scene,
          toolbar,
          copilot,
        }) => {
          let connections = 0
          if (intercepted) {
            await page.routeWebSocket('**/ws/ml/copilot**', (client) => {
              connections++
              const server = client.connectToServer()
              server.onMessage((message) => client.send(message))
            })
          }
          await page.reload()
          await page.setBodyDimensions({ width: 1500, height: 1000 })
          await page.evaluate(() => {
            const sockets: WeakRef<WebSocket>[] = []
            Reflect.set(window, '__shutdownCopilotSockets', sockets)
            window.WebSocket = new Proxy(window.WebSocket, {
              construct(target, args, newTarget) {
                const socket = Reflect.construct(
                  target,
                  args,
                  newTarget
                ) as WebSocket
                if (
                  new URL(String(args[0]), location.href).pathname.includes(
                    '/ws/ml/copilot'
                  )
                ) {
                  sockets.push(new WeakRef(socket))
                }
                return socket
              },
            })
          })
          await homePage.goToModelingScene()
          await scene.settled()
          await toolbar.closePane(DefaultLayoutPaneID.Code)
          await toolbar.openPane(DefaultLayoutPaneID.Zookeeper)
          await expect(copilot.conversationInput).toBeVisible()
          await expect
            .poll(
              () =>
                page.evaluate(() => {
                  const refs = Reflect.get(
                    window,
                    '__shutdownCopilotSockets'
                  ) as WeakRef<WebSocket>[]
                  return refs.some(
                    (ref) => ref.deref()?.readyState === WebSocket.OPEN
                  )
                }),
              { timeout: 30_000 }
            )
            .toBe(true)
          expect(connections).toBe(intercepted ? 1 : 0)

          if (explicitClose) {
            const started = performance.now()
            const closed = await page.evaluate(async () => {
              const refs = Reflect.get(
                window,
                '__shutdownCopilotSockets'
              ) as WeakRef<WebSocket>[]
              const sockets = refs.flatMap((ref) => {
                const socket = ref.deref()
                return socket && socket.readyState !== WebSocket.CLOSED
                  ? [socket]
                  : []
              })
              if (!sockets.length)
                throw new Error('No live copilot socket to close')
              return Promise.all(
                sockets.map(
                  (socket) =>
                    new Promise<{ code: number; wasClean: boolean }>(
                      (resolve, reject) => {
                        const onClose = (event: CloseEvent) => {
                          clearTimeout(timer)
                          resolve({
                            code: event.code,
                            wasClean: event.wasClean,
                          })
                        }
                        const timer = setTimeout(() => {
                          socket.removeEventListener('close', onClose)
                          reject(
                            new Error(
                              'Copilot socket did not close within 10 seconds'
                            )
                          )
                        }, 10_000)
                        socket.addEventListener('close', onClose, {
                          once: true,
                        })
                        socket.close(1000, 'shutdown probe')
                      }
                    )
                )
              )
            })
            console.log(
              '[webkit-explicit-close]',
              JSON.stringify({
                intercepted,
                durationMs: Math.round(performance.now() - started),
                closed,
              })
            )
            expect(closed.length).toBeGreaterThan(0)
            // Detect a reconnect already in progress rather than silently closing
            // an obsolete socket and claiming that the connection was cleaned up.
            expect(
              await page.evaluate(() => {
                const refs = Reflect.get(
                  window,
                  '__shutdownCopilotSockets'
                ) as WeakRef<WebSocket>[]
                return refs.every((ref) => {
                  const socket = ref.deref()
                  return !socket || socket.readyState === WebSocket.CLOSED
                })
              })
            ).toBe(true)
          }
        })
      }
    }
  }
)
