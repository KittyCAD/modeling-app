import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

// Paired preview/current cases on one worker. Only the copilot destination
// changes; engine connections and the modeling-app build stay identical.
const BACKEND_HOSTS = {
  current: 'api.dev.zoo.dev',
  unfixedPreview: 'api-pr-5150.dev.zoo.dev',
  fixedPreview: 'api-pr-5193.dev.zoo.dev',
} as const
test.describe(
  'Zookeeper API preview shutdown comparison',
  { tag: ['@web', '@zookeeper'] },
  () => {
    test.skip(
      process.env.PLAYWRIGHT_WEBKIT_TEARDOWN_DIAGNOSTICS !== '1',
      'Only run with the temporary shutdown observer'
    )
    for (const explicitClose of [false, true]) {
      for (const backend of [
        'current',
        'unfixedPreview',
        'fixedPreview',
      ] as const) {
        test(`${backend} backend, ${explicitClose ? 'await socket close' : 'normal teardown'}`, async ({
          page,
          homePage,
          scene,
          toolbar,
          copilot,
        }) => {
          let connections = 0
          await page.routeWebSocket('**/ws/ml/copilot**', (client) => {
            connections++
            const server = client.connectToServer()
            server.onMessage((message) => client.send(message))
          })
          await page.reload()
          await page.setBodyDimensions({ width: 1500, height: 1000 })
          await page.evaluate((targetHost) => {
            const sockets: WeakRef<WebSocket>[] = []
            Reflect.set(window, '__shutdownCopilotSockets', sockets)
            window.WebSocket = new Proxy(window.WebSocket, {
              construct(target, args, newTarget) {
                const url = new URL(String(args[0]), location.href)
                const copilotSocket = url.pathname.includes('/ws/ml/copilot')
                if (copilotSocket) {
                  url.host = targetHost
                  args[0] = url.toString()
                }
                const socket = Reflect.construct(
                  target,
                  args,
                  newTarget
                ) as WebSocket
                if (copilotSocket) {
                  sockets.push(new WeakRef(socket))
                }
                return socket
              },
            })
          }, BACKEND_HOSTS[backend])
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
          expect(connections).toBe(1)
          const hosts = await page.evaluate(() => {
            const refs = Reflect.get(
              window,
              '__shutdownCopilotSockets'
            ) as WeakRef<WebSocket>[]
            return refs.flatMap((ref) => {
              const socket = ref.deref()
              return socket ? [new URL(socket.url).hostname] : []
            })
          })
          expect(hosts).toEqual([BACKEND_HOSTS[backend]])

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
                backend,
                repeat: test.info().repeatEachIndex,
                durationMs: Math.round(performance.now() - started),
                closed,
              })
            )
            expect(closed.length).toBeGreaterThan(0)
            if (backend === 'fixedPreview') {
              expect(closed).toEqual([{ code: 1000, wasClean: true }])
            }
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
