import { getAppCompositionDefine } from '@root/vite.appManifest'
import { defaultRegistryItemIds } from '@src/registry/defaultComposition'
import { _electron as electron, expect, test } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PRUSA_SLICER_OPEN_STL_CHANNEL } from '@src/registry/plugins/prusaSlicer/ipc'

async function createBootstrap(directory: string, beforeStartup = '') {
  const bootstrapPath = path.join(directory, 'bootstrap.cjs')
  const documents = path.join(directory, 'documents')
  await fs.mkdir(documents, { recursive: true })
  await fs.writeFile(
    bootstrapPath,
    `
    const { app } = require('electron')
    app.setPath('appData', ${JSON.stringify(directory)})
    app.setPath('documents', ${JSON.stringify(documents)})
    ${beforeStartup}
    require(${JSON.stringify(path.resolve('.vite/build/main.js'))})
  `
  )
  return bootstrapPath
}

// These launches need no account or engine: composition is resolved before login.
test.describe('app manifest startup @desktop', () => {
  test.skip(
    process.env.TARGET !== 'desktop',
    'Desktop startup configuration only'
  )
  test.describe.configure({ mode: 'serial' })

  test('rejects an invalid manifest before creating a window', async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'app-manifest-error-')
    )
    const reportPath = path.join(directory, 'error.json')
    const manifestPath = path.join(directory, 'invalid.toml')
    await fs.writeFile(manifestPath, 'schema-version = 99')
    // Capture the native error dialog without displaying a modal during this test.
    // All parsing, startup validation, and exit behavior still run in the real main process.
    const bootstrapPath = await createBootstrap(
      directory,
      `
      const { dialog, BrowserWindow } = require('electron')
      dialog.showErrorBox = (title, message) => {
        require('node:fs').writeFileSync(${JSON.stringify(reportPath)}, JSON.stringify({ title, message, windows: BrowserWindow.getAllWindows().length }))
      }
    `
    )
    let instance: Awaited<ReturnType<typeof electron.launch>> | undefined
    try {
      try {
        instance = await electron.launch({
          args: [bootstrapPath, '--no-sandbox', '--app-config', manifestPath],
          env: { ...process.env, NODE_ENV: 'test' },
        })
      } catch {
        // A process that exits before the debugger attaches rejects launch.
      }
      await expect
        .poll(async () => {
          try {
            return await fs.readFile(reportPath, 'utf8')
          } catch {
            return ''
          }
        })
        .toContain('schema-version must be 1')
      const report: unknown = JSON.parse(await fs.readFile(reportPath, 'utf8'))
      expect(report).toMatchObject({
        title: 'Unable to start app configuration',
        windows: 0,
      })
      if (instance) {
        const child = instance.process()
        if (child.exitCode === null) {
          await new Promise<void>((resolve) =>
            child.once('exit', () => resolve())
          )
        }
        expect(child.exitCode).toBe(1)
      }
    } finally {
      if (instance?.process().exitCode === null) await instance.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  test('uses the embedded composition without a CLI argument', async () => {
    const expected = await getAppCompositionDefine('development')
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'app-manifest-default-')
    )
    const bootstrapPath = await createBootstrap(directory)
    const instance = await electron.launch({
      args: [bootstrapPath, '--no-sandbox'],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    try {
      const page = await instance.firstWindow()
      await page.waitForFunction(() => Boolean(window.app))
      const composition = await page.evaluate(() =>
        window.electron?.getStartupComposition()
      )
      expect(JSON.stringify(composition)).toBe(
        expected.__APP_STARTUP_COMPOSITION__
      )
      const pluginSettings = await page.evaluate(() =>
        Object.keys(window.app.settings.actor.getSnapshot().context.plugins)
      )
      expect(pluginSettings.includes('command-bar')).toBe(
        composition?.registryItemIds.includes('zoo:commandBar')
      )
      expect(pluginSettings.includes('slicer')).toBe(
        composition?.registryItemIds.includes('zoo:slicer')
      )
    } finally {
      await instance.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  test('lets a CLI manifest override the embedded selection', async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'app-manifest-override-')
    )
    const manifestPath = path.join(directory, 'default.toml')
    await fs.writeFile(manifestPath, 'schema-version = 1\nbase = "zoo:default"')
    const bootstrapPath = await createBootstrap(directory)
    const instance = await electron.launch({
      args: [bootstrapPath, '--no-sandbox', '--app-config', manifestPath],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    try {
      const page = await instance.firstWindow()
      await page.waitForFunction(() => Boolean(window.app))
      expect(
        await page.evaluate(() => window.electron?.getStartupComposition())
      ).toEqual({ registryItemIds: defaultRegistryItemIds })
      expect(
        await page.evaluate(() =>
          Object.keys(window.app.settings.actor.getSnapshot().context.plugins)
        )
      ).toContain('command-bar')
    } finally {
      await instance.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  test('reads a manifest once and uses it for renderer, native handlers, reloads, and new windows', async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'app-manifest-launch-')
    )
    const manifestPath = path.join(directory, 'compact app.toml')
    await fs.copyFile('examples/app-configs/compact.toml', manifestPath)
    const bootstrapPath = await createBootstrap(directory)
    const instance = await electron.launch({
      args: [bootstrapPath, '--no-sandbox', '--app-config', manifestPath],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    try {
      const page = await instance.firstWindow()
      await page.waitForFunction(() => Boolean(window.app))
      const composition = await page.evaluate(() =>
        window.electron?.getStartupComposition()
      )
      expect(composition?.registryItemIds).not.toContain('zoo:commandBar')
      expect(composition?.registryItemIds).not.toContain('zoo:slicer')
      const settings = await page.evaluate(() =>
        Object.keys(window.app.settings.actor.getSnapshot().context.plugins)
      )
      expect(settings).not.toContain('command-bar')
      expect(settings).not.toContain('slicer')
      const nativeResult = await page.evaluate(async (channelSuffix) => {
        try {
          await window.electron?.pluginIpc.invoke(`plugin:${channelSuffix}`)
          return 'unexpected native handler'
        } catch (error) {
          return String(error)
        }
      }, PRUSA_SLICER_OPEN_STL_CHANNEL.slice('plugin:'.length))
      expect(nativeResult).toContain('No handler registered')

      await fs.writeFile(
        manifestPath,
        'schema-version = 1\nbase = "zoo:default"'
      )
      await page.reload()
      await page.waitForFunction(() => Boolean(window.app))
      expect(
        await page.evaluate(() => window.electron?.getStartupComposition())
      ).toEqual(composition)
      expect(
        await page.evaluate(() =>
          Object.keys(window.app.settings.actor.getSnapshot().context.plugins)
        )
      ).not.toContain('command-bar')

      const nextWindow = instance.waitForEvent('window')
      await instance.evaluate(({ app }) => {
        app.emit('second-instance', {}, [process.execPath], process.cwd())
      })
      const secondPage = await nextWindow
      await secondPage.waitForFunction(() => Boolean(window.app))
      expect(
        await secondPage.evaluate(() =>
          window.electron?.getStartupComposition()
        )
      ).toEqual(composition)
      expect(
        await secondPage.evaluate(() =>
          Object.keys(window.app.settings.actor.getSnapshot().context.plugins)
        )
      ).not.toContain('command-bar')
    } finally {
      await instance.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
