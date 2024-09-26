import type { Page } from '@playwright/test'
import { test as base } from '@playwright/test'
import { getUtils, setup, tearDown } from './test-utils'
import fsp from 'fs/promises'
import { join } from 'path'
import { CmdBarFixture } from './cmdBarFixture'
import { EditorFixture } from './editorFixture'
import { ToolbarFixture } from './toolbarFixture'
import { SceneFixture } from './sceneFixture'

export class AuthenticatedApp {
  public readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  async initialise(code = '') {
    const u = await getUtils(this.page)

    await this.page.addInitScript(async (code) => {
      localStorage.setItem('persistCode', code)
      ;(window as any).playwrightSkipFilePicker = true
    }, code)

    await this.page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()
  }
  getInputFile = (fileName: string) => {
    return fsp.readFile(
      join('src', 'wasm-lib', 'tests', 'executor', 'inputs', fileName),
      'utf-8'
    )
  }
}

export const test = base.extend<{
  app: AuthenticatedApp
  cmdBar: CmdBarFixture
  editor: EditorFixture
  toolbar: ToolbarFixture
  scene: SceneFixture
}>({
  app: async ({ page }, use) => {
    await use(new AuthenticatedApp(page))
  },
  cmdBar: async ({ page }, use) => {
    await use(new CmdBarFixture(page))
  },
  editor: async ({ page }, use) => {
    await use(new EditorFixture(page))
  },
  toolbar: async ({ page }, use) => {
    await use(new ToolbarFixture(page))
  },
  scene: async ({ page }, use) => {
    await use(new SceneFixture(page))
  },
})

test.beforeEach(async ({ context, page }, testInfo) => {
  await setup(context, page, testInfo)
})

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

export { expect } from '@playwright/test'
