import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import { expect, test as base } from '@e2e/playwright/zoo-test'
import type {
  MigrationClientMessage,
  MigrationOperation,
} from '@src/lib/kclMigration/protocol'

// Exercise app/editor/storage integration without invoking a paid engine or converter.
const test = base.extend({
  context: async ({ context, baseURL }, provide) => {
    const appOrigin = new URL(baseURL ?? 'http://localhost:3000').origin
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url())
      if (!url.protocol.startsWith('http') || url.origin === appOrigin)
        return route.fallback()
      const pathname = url.pathname

      const body =
        pathname === '/user'
          ? {
              id: '12945000-0000-4000-8000-000000000001',
              name: 'Migration Test',
              username: 'migration-test',
              email: 'migration@example.com',
              image: '',
              created_at: '2026-09-01T12:00:00Z',
              updated_at: '2026-09-01T12:00:00Z',
            }
          : pathname === '/user/features'
            ? {
                features: [
                  { id: 'zookeeper_kcl_migration' },
                  { id: OPFS_CLOUD_FEATURE_FLAG },
                ],
              }
            : pathname === '/meta/announcements' ||
                pathname === '/announcements'
              ? { announcements: [] }
              : pathname === '/user/projects'
                ? []
                : {}
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })
    })
    await context.routeWebSocket('**/ws/modeling/commands**', (socket) =>
      socket.close()
    )
    await context.routeWebSocket('**/ws/ml/copilot**', (socket) =>
      socket.close()
    )
    await provide(context)
  },
})

test.use({ userFeatures: [OPFS_CLOUD_FEATURE_FLAG] })

const source = '@settings(kclVersion = 2.0)\nlength = 10mm\n'
const candidate = '@settings(kclVersion = "3.0-preview")\nlength = 11mm\n'

test.describe(
  'Sponsored KCL project migration',
  { tag: ['@web', '@desktop'] },
  () => {
    test('captures unsaved and supporting files, reviews, applies and undoes a project', async ({
      page,
      context,
      homePage,
    }, testInfo) => {
      await context.route('**/user/features', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            features: [
              { id: 'zookeeper_kcl_migration' },
              { id: OPFS_CLOUD_FEATURE_FLAG },
            ],
          }),
        })
      )
      let received: MigrationClientMessage | undefined
      let release: () => void = () => {
        throw new Error('Migration has not started')
      }
      await page.routeWebSocket('**/ws/ml/kcl-migration', (socket) => {
        socket.onMessage((data) => {
          const message: MigrationClientMessage = JSON.parse(data.toString())
          if (message.type !== 'start') return
          received = message
          const request = message.request
          const operation: MigrationOperation = {
            id: request.request_id,
            project_snapshot: request.project_snapshot,
            target: request.target,
            deadline: new Date(Date.now() + 20 * 60_000).toISOString(),
            status: 'running',
          }
          socket.send(JSON.stringify({ type: 'operation', operation }))
          release = () =>
            socket.send(
              JSON.stringify({
                type: 'operation',
                operation: {
                  ...operation,
                  status: 'succeeded',
                  result: {
                    status: 'succeeded',
                    detail: 'Validation passed.',
                    files: {
                      ...request.current_files,
                      [request.entrypoint]: Array.from(
                        new TextEncoder().encode(candidate)
                      ),
                    },
                    validation: {
                      source_version: '2.0',
                      target: '3.0-preview',
                      runtime_version: '0.3.186',
                      rules_revision: 'test-guide',
                      summary:
                        'Physical properties and parameter checks passed.',
                      source_executed: true,
                      target_executed: true,
                      geometry_preserved: true,
                      behavior_preserved: true,
                    },
                  },
                },
              })
            )
        })
      })
      await page.reload()
      await page.setBodyDimensions({ width: 1440, height: 1000 })
      await expect(page.getByTestId('home-new-file')).toBeVisible()
      const localLibrary = page.getByRole('link', {
        name: 'Open Projects library',
      })
      if (await localLibrary.isVisible()) await localLibrary.click()
      await homePage.goToModelingScene()
      await page.waitForFunction(() =>
        Boolean(window.app?.project?.executingEditor.value)
      )
      await page.evaluate(async (code) => {
        const project = window.app.project
        const editor = project?.executingEditor.value
        if (!project || !editor) throw new Error('No project editor')
        editor.updateCodeEditor(code, { shouldExecute: false })
        await editor.flushWriteToFile()
        await window.app.fileOperations.createDirectory(
          window.fsZds.join(project.path, 'parts')
        )
        await window.app.fileOperations.writeFile(
          window.fsZds.join(project.path, 'parts', 'support.bin'),
          new Uint8Array([0, 255, 128])
        )
        editor.updateCodeEditor(code.replace('10mm', '11mm'), {
          shouldExecute: false,
          shouldWriteToDisk: false,
        })
      }, source)
      await page.getByRole('button', { name: 'Migrate to KCL 3' }).click()
      const start = page.getByRole('button', { name: 'Start Free Migration' })
      await expect(start).toBeDisabled()
      await page.getByRole('checkbox', { name: /I agree to migrate/ }).check()
      await start.click()
      await expect(
        page.getByRole('status').filter({ hasText: 'Converting' })
      ).toBeVisible()
      expect(received?.type).toBe('start')
      if (received?.type !== 'start') throw new Error('No migration snapshot')
      expect(received.request.current_files['parts/support.bin']).toEqual([
        0, 255, 128,
      ])
      expect(
        new TextDecoder().decode(
          new Uint8Array(
            received.request.current_files[received.request.entrypoint]
          )
        )
      ).toContain('11mm')
      release()
      await expect(
        page.getByRole('heading', { name: 'Review Changes' })
      ).toBeVisible()
      await page.screenshot({
        path: testInfo.outputPath('migration-review.png'),
      })
      const editorCode = () =>
        page.evaluate(() => window.app.project?.executingEditor.value?.code)
      expect(await editorCode()).toContain('kclVersion = 2.0')
      await page.getByRole('button', { name: 'Apply Migration' }).click()
      await expect(
        page.getByRole('button', { name: 'Undo Migration' })
      ).toBeVisible()
      expect(await editorCode()).toBe(candidate)
      await page.getByRole('button', { name: 'Undo Migration' }).click()
      await expect(
        page
          .getByRole('status')
          .filter({ hasText: 'original project was restored' })
      ).toBeVisible()
      expect(await editorCode()).toBe(source.replace('10mm', '11mm'))
      expect(
        await page.evaluate(async () => {
          const project = window.app.project
          if (!project) throw new Error('No project')
          return Array.from(
            await window.app.fileOperations.readFile(
              window.fsZds.join(project.path, 'parts', 'support.bin')
            )
          )
        })
      ).toEqual([0, 255, 128])
    })
  }
)
