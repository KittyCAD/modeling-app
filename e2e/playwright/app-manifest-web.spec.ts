import { expect, test } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'vite'

declare global {
  interface Window {
    reportManifestPlugins: (
      plugins: string[],
      desktop: boolean
    ) => Promise<void>
  }
}

test.describe('Vite app composition @web', () => {
  test.skip(process.env.TARGET !== 'web', 'Web dev-server startup only')
  test.describe.configure({ mode: 'serial' })

  test('rejects an invalid manifest before starting the server', async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'vite-manifest-invalid-')
    )
    const previousPath = process.env.ZOO_APP_CONFIG
    try {
      const filename = path.join(directory, 'invalid.toml')
      await fs.writeFile(filename, 'schema-version = 99')
      process.env.ZOO_APP_CONFIG = filename
      await expect(
        createServer({
          configFile: path.resolve('vite.config.ts'),
          server: { open: false, port: 0 },
        })
      ).rejects.toThrow('schema-version must be 1')
    } finally {
      if (previousPath === undefined) delete process.env.ZOO_APP_CONFIG
      else process.env.ZOO_APP_CONFIG = previousPath
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  test('serves the embedded composition without browser access to the TOML file', async ({
    page,
  }) => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'vite-manifest-web-')
    )
    const filename = path.join(directory, 'compact.toml')
    const previousPath = process.env.ZOO_APP_CONFIG
    const cacheDir = path.join(
      process.cwd(),
      'node_modules',
      '.vite-manifest-tests',
      path.basename(directory)
    )
    let server: Awaited<ReturnType<typeof createServer>> | undefined
    const snapshots: { plugins: string[]; desktop: boolean }[] = []
    await page.exposeFunction(
      'reportManifestPlugins',
      (plugins: string[], desktop: boolean) => {
        snapshots.push({ plugins, desktop })
      }
    )
    await page.addInitScript(() => {
      let currentApp: Window['app'] | undefined
      Object.defineProperty(window, 'app', {
        configurable: true,
        get: () => currentApp,
        set: (app: Window['app']) => {
          currentApp = app
          void window
            .reportManifestPlugins(
              Object.keys(app.settings.actor.getSnapshot().context.plugins),
              Boolean(window.electron)
            )
            .catch(() => {})
        },
      })
    })
    const requestedUrls: string[] = []
    page.on('request', (request) => requestedUrls.push(request.url()))
    try {
      await fs.copyFile('examples/app-configs/compact.toml', filename)
      process.env.ZOO_APP_CONFIG = filename
      server = await createServer({
        configFile: path.resolve('vite.config.ts'),
        cacheDir,
        server: { open: false, host: '127.0.0.1', port: 0 },
      })
      await server.listen()
      const url = server.resolvedUrls?.local[0]
      expect(url).toBeTruthy()
      if (!url) throw new Error('No Vite server URL')
      // Resolution has already happened. Neither the browser nor the app needs the file now.
      await fs.rm(filename)
      await page.route('**/*', async (route) => {
        if (
          route.request().isNavigationRequest() &&
          new URL(route.request().url()).origin !== new URL(url).origin
        ) {
          await route.abort()
        } else {
          await route.continue()
        }
      })
      // Capture the real app at initialization, before the normal signed-out
      // flow navigates to authentication. No account or API token is required.
      await page.goto(url, { waitUntil: 'commit' })
      await expect.poll(() => snapshots.length, { timeout: 60_000 }).toBe(1)
      expect(snapshots[0].desktop).toBe(false)
      expect(snapshots[0].plugins).not.toContain('command-bar')
      expect(snapshots[0].plugins).not.toContain('publish')
      expect(snapshots[0].plugins).not.toContain('slicer')
      expect(
        requestedUrls.some((requested) => requested.includes('compact.toml'))
      ).toBe(false)
      await page.goto(url, { waitUntil: 'commit' })
      await expect.poll(() => snapshots.length, { timeout: 60_000 }).toBe(2)
      expect(snapshots[1]).toEqual(snapshots[0])
    } finally {
      await server?.close()
      await fs.rm(cacheDir, { recursive: true, force: true })
      if (previousPath === undefined) delete process.env.ZOO_APP_CONFIG
      else process.env.ZOO_APP_CONFIG = previousPath
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
