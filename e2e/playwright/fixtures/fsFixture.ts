import { type IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import { type Page } from '@playwright/test'

// We have to proxy fs calls to the page context.
export const FsFixture = (page: Page): IZooDesignStudioFS => {
  return new Proxy(
    {},
    {
      get(_target, propertyName, _receiver) {
        return async (...args) => page.evaluate(async (args) => {
          console.log(JSON.stringify(Object.keys(window.fsZds)))
          console.log('----', args)
          return window.fsZds[args[0]](...args.slice(1))
        }, [propertyName, ...args])
      },
      // A necessary `as` since we're meta-programming and that's really out of TS's abilities to infer
      // window.fsZds is the interface we want to align with, and that's dynamically loaded.
    }
  ) as IZooDesignStudioFS
}
