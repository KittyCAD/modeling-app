import { type PromisifiedZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import { type Page } from '@playwright/test'

// We have to proxy fs calls to the page context.
export const FsFixture = (page: Page): PromisifiedZooDesignStudioFS => {
  return new Proxy(
    {},
    {
      get(_target, propertyName, _receiver) {
        return async (...args: any[]) => {
          // We need to convert any Buffers to Uint8Array before it reaches
          // the Electron boundary.
          const argsBuffersToUint8Arrays = args.map((a: unknown) => {
            if (a instanceof Uint8Array) {
              return Uint8Array.from(a)
            }
            return a
          })

          return page.evaluate(
            async (args) => {
              // I'm sorry but Proxy typing is a pain in my butt not worth the effort right now
              const f =
                window.fsZds !== undefined &&
                // @ts-expect-error
                (window.fsZds[args[0].toString()] || (() => {}))

              return f(...args.slice(1))
            },
            [propertyName, ...argsBuffersToUint8Arrays]
          )
        }
      },
      // A necessary `as` since we're meta-programming and that's really out of TS's abilities to infer
      // window.fsZds is the interface we want to align with, and that's dynamically loaded.
    }
  ) as PromisifiedZooDesignStudioFS
}
