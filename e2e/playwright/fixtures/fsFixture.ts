import { type Page } from '@playwright/test'
import { type PromisifiedZooDesignStudioFS } from '@src/lib/fs-zds/interface'

// We have to proxy fs calls to the page context.
export const FsFixture = (page: Page): PromisifiedZooDesignStudioFS => {
  return new Proxy(
    {},
    {
      get(_target, propertyName, _receiver) {
        return async (...args: any[]) => {
          // A document can finish loading before the deferred app bootstrap
          // binds its filesystem, including after a test-triggered reload.
          await page.waitForFunction(() => window.fsZds !== undefined)
          // We need to convert any Buffers to Uint8Array before it reaches
          // the Electron boundary.
          const argsBuffersToUint8Arrays = args.map((a: unknown) => {
            if (a instanceof Uint8Array) {
              return Uint8Array.from(a)
            }
            return a
          })

          // Return errors instead of rejecting inside evaluate: Firefox's
          // Juggler bridge also emits pageerror for evaluate rejections
          // (including OPFS Promise.reject('ENOENT')).
          const result = await page.evaluate(
            async (
              args
            ): Promise<
              { ok: true; value: unknown } | { ok: false; message: string }
            > => {
              // I'm sorry but Proxy typing is a pain in my butt not worth the effort right now
              const f =
                window.fsZds !== undefined &&
                // @ts-expect-error
                (window.fsZds[args[0].toString()] || (() => {}))

              try {
                return { ok: true, value: await f(...args.slice(1)) }
              } catch (error) {
                return {
                  ok: false,
                  message:
                    error instanceof Error ? error.message : String(error),
                }
              }
            },
            [propertyName, ...argsBuffersToUint8Arrays]
          )

          if (!result.ok) {
            throw new Error(result.message)
          }
          return result.value
        }
      },
      // A necessary `as` since we're meta-programming and that's really out of TS's abilities to infer
      // window.fsZds is the interface we want to align with, and that's dynamically loaded.
    }
  ) as PromisifiedZooDesignStudioFS
}
