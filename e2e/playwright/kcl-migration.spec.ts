import { test as base, expect } from '@e2e/playwright/zoo-test'
import { waitForAppLoad } from '@e2e/playwright/test-utils'
import type {
  MigrationClientMessage,
  MigrationOperation,
  MigrationHistoryEntry,
} from '@src/lib/kclMigration/protocol'
import { DefaultLayoutPaneID } from '@src/lib/layout'
const conversationId = '12945000-0000-4000-8000-000000000002'

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
                features: [{ id: 'zookeeper_kcl_migration' }],
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
    await context.routeWebSocket('**/ws/ml/copilot**', (socket) => {
      socket.onMessage((data) => {
        const message: { type: string } = JSON.parse(data.toString())
        if (message.type === 'list_modes')
          socket.send(
            JSON.stringify({
              conversation_id: { conversation_id: conversationId },
            })
          )
        if (message.type === 'ping') socket.send(JSON.stringify({ pong: {} }))
      })
    })
    await provide(context)
  },
})

const source = '@settings(kclVersion = 2.0)\nlength = 10mm\n'
const candidate = '@settings(kclVersion = "3.0")\nlength = 11mm\n'

test.describe(
  'Sponsored KCL project migration',
  { tag: ['@web', '@zookeeper'] },
  () => {
    test('captures unsaved and supporting files, cancels, automatically applies and undoes a project', async ({
      page,
      context,
      homePage,
      toolbar,
    }, testInfo) => {
      await context.route('**/user/features', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            features: [{ id: 'zookeeper_kcl_migration' }],
          }),
        })
      )
      let received: MigrationClientMessage | undefined
      const history = new Map<string, MigrationHistoryEntry>()
      const applicationStates: string[] = []
      let release: () => void = () => {
        throw new Error('Migration has not started')
      }
      await page.routeWebSocket('**/ws/ml/kcl-migration**', (socket) => {
        socket.onMessage((data) => {
          const message: MigrationClientMessage = JSON.parse(data.toString())
          if (message.type === 'history') {
            socket.send(
              JSON.stringify({
                type: 'history',
                conversation_id: message.conversation_id,
                entries: [...history.values()].reverse(),
              })
            )
            return
          }
          if (message.type === 'application') {
            const entry = history.get(message.operation_id)
            if (!entry) throw new Error('Missing migration history')
            expect(message.expected_revision).toBe(entry.application.revision)
            entry.application = {
              status: message.status,
              revision: message.expected_revision + 1,
            }
            applicationStates.push(message.status)
            socket.send(
              JSON.stringify({
                type: 'application',
                operation_id: message.operation_id,
                application: entry.application,
              })
            )
            return
          }
          if (message.type === 'cancel' && received?.type === 'start') {
            const entry = history.get(received.request.request_id)
            if (entry) entry.status = 'cancelled'
            socket.send(
              JSON.stringify({
                type: 'operation',
                operation: {
                  id: received.request.request_id,
                  project_snapshot: received.request.project_snapshot,
                  target: received.request.target,
                  deadline: new Date(Date.now() + 20 * 60_000).toISOString(),
                  status: 'cancelled',
                  result: {
                    status: 'cancelled',
                    detail: 'Migration cancelled.',
                    files: {},
                  },
                },
              })
            )
            return
          }
          if (message.type !== 'start') return
          received = message
          const request = message.request
          expect(request.conversation_id).toBe(conversationId)
          const entry: MigrationHistoryEntry = {
            operation_id: request.request_id,
            conversation_id: conversationId,
            status: 'running',
            created_at: new Date().toISOString(),
            detail: '',
            application: { status: 'not_applied', revision: 0 },
          }
          history.set(entry.operation_id, entry)
          const operation: MigrationOperation = {
            id: request.request_id,
            project_snapshot: request.project_snapshot,
            target: request.target,
            deadline: new Date(Date.now() + 20 * 60_000).toISOString(),
            status: 'running',
          }
          socket.send(JSON.stringify({ type: 'operation', operation }))
          socket.send(
            JSON.stringify({
              type: 'progress',
              operation_id: request.request_id,
              message: {
                reasoning: {
                  type: 'text',
                  content: 'Checking matching views.',
                },
              },
            })
          )
          release = () => {
            entry.status = 'succeeded'
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
                      target: '3.0',
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
          }
        })
      })
      await page.reload()
      await waitForAppLoad(page)
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
        await window.app.fileOperations.writeFile(
          window.fsZds.join(project.path, 'thumbnail.png'),
          new Uint8Array([1, 2, 3])
        )
        editor.updateCodeEditor(code.replace('10mm', '11mm'), {
          shouldExecute: false,
          shouldWriteToDisk: false,
        })
      }, source)
      await toolbar.openPane(DefaultLayoutPaneID.Zookeeper)
      const migrate = page.getByRole('button', { name: 'Migrate to KCL 3' })
      await expect(migrate).toBeVisible()
      for (const code of [
        '@settings(kclVersion = 1.0)\nlength = 11mm\n',
        candidate,
        'length = 11mm\n',
        '@settings(defaultLengthUnit = mm)\nlength = 11mm\n',
        '@settings(kclVersion = 2.0)\nlength = (\n',
      ]) {
        await page.evaluate((code) => {
          window.app.project?.executingEditor.value?.updateCodeEditor(code, {
            shouldExecute: false,
            shouldWriteToDisk: false,
          })
        }, code)
        await expect(migrate).toBeHidden()
      }
      await page.evaluate(
        (code) => {
          window.app.project?.executingEditor.value?.updateCodeEditor(code, {
            shouldExecute: false,
            shouldWriteToDisk: false,
          })
        },
        source.replace('10mm', '11mm')
      )
      await expect(migrate).toBeVisible()
      // A closed entrypoint is read from disk, regardless of the active editor.
      const entrypoint = await page.evaluate(async (code) => {
        const project = window.app.project
        if (!project) throw new Error('No project')
        const info = project.projectIORefSignal.value
        const path = window.fsZds.join(project.path, 'parts', 'preview.kcl')
        await window.app.fileOperations.writeFile(path, code)
        project.projectIORefSignal.value = { ...info, default_file: path }
        return info.default_file
      }, candidate)
      await expect(migrate).toBeHidden()
      await page.evaluate(async (entrypoint) => {
        const project = window.app.project
        if (!project) throw new Error('No project')
        const info = project.projectIORefSignal.value
        project.projectIORefSignal.value = {
          ...info,
          default_file: entrypoint,
        }
        await window.app.fileOperations.remove(info.default_file)
      }, entrypoint)
      await expect(migrate).toBeVisible()
      await migrate.click()
      const start = page.getByRole('button', { name: 'Start Free Migration' })
      await expect(start).toBeEnabled()
      await start.click()
      await expect(
        page.getByRole('status').filter({ hasText: 'Converting' })
      ).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'Collapse', exact: true })
      ).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'Cancel Migration' })
      ).toHaveCount(0)
      const cancel = page.getByTestId('ml-ephant-conversation-cancel-button')
      await expect(cancel).toBeVisible()
      await cancel.click()
      await expect(
        page.getByRole('status').filter({ hasText: 'Migration cancelled.' })
      ).toBeVisible()
      await expect(cancel).toBeHidden()
      await migrate.click()
      await start.click()
      await expect(
        page.getByRole('status').filter({ hasText: 'Converting' })
      ).toBeVisible()
      expect(received?.type).toBe('start')
      if (received?.type !== 'start') throw new Error('No migration snapshot')
      expect(received.request.current_files['parts/support.bin']).toEqual([
        0, 255, 128,
      ])
      expect(received.request.current_files['thumbnail.png']).toBeUndefined()
      expect(
        new TextDecoder().decode(
          new Uint8Array(
            received.request.current_files[received.request.entrypoint]
          )
        )
      ).toContain('11mm')
      const editorCode = () =>
        page.evaluate(() => window.app.project?.executingEditor.value?.code)
      expect(await editorCode()).toContain('kclVersion = 2.0')
      // Completion applies through the session controller even with the pane closed.
      await toolbar.closePane(DefaultLayoutPaneID.Zookeeper)
      release()
      await expect.poll(editorCode).toBe(candidate)
      await expect.poll(() => applicationStates).toEqual(['applied'])
      await toolbar.openPane(DefaultLayoutPaneID.Zookeeper)
      await expect(
        page.getByRole('status').filter({ hasText: 'Migrated to KCL 3' })
      ).toBeVisible()
      expect(await editorCode()).toBe(candidate)
      await expect(cancel).toBeHidden()
      const completedMigration = page
        .getByRole('region', { name: 'KCL migration', exact: true })
        .filter({ hasText: 'Migrated to KCL 3.0.' })
      const reasoning = completedMigration.getByRole('button', {
        name: 'See reasoning',
      })
      await expect(reasoning).toHaveAttribute('aria-expanded', 'false')
      await reasoning.click()
      await expect(page.getByText('Checking matching views.')).toBeVisible()
      await completedMigration
        .getByRole('button', { name: 'Collapse', exact: true })
        .click()
      await page.screenshot({
        path: testInfo.outputPath('migration-applied.png'),
      })
      // Successful execution refreshes this generated preview after Apply.
      await page.evaluate(async () => {
        const project = window.app.project
        if (!project) throw new Error('No project')
        await window.app.fileOperations.writeFile(
          window.fsZds.join(project.path, 'thumbnail.png'),
          new Uint8Array([4, 5, 6])
        )
      })
      await toolbar.closePane(DefaultLayoutPaneID.Zookeeper)
      await toolbar.openPane(DefaultLayoutPaneID.Zookeeper)
      await expect(
        page.getByRole('status').filter({ hasText: 'Migrated to KCL 3' })
      ).toBeVisible()
      await page
        .getByRole('button', { name: 'arrow turn left', exact: true })
        .click()
      await expect.poll(editorCode).toBe(source.replace('10mm', '11mm'))
      await page
        .getByRole('button', { name: 'arrow turn right', exact: true })
        .click()
      await expect.poll(editorCode).toBe(candidate)
      await expect
        .poll(() => applicationStates)
        .toEqual(['applied', 'undone', 'applied'])
      expect(
        await page.evaluate(async () => {
          const project = window.app.project
          if (!project) throw new Error('No project')
          return Array.from(
            await window.app.fileOperations.readFile(
              window.fsZds.join(project.path, 'thumbnail.png')
            )
          )
        })
      ).toEqual([4, 5, 6])
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
      // Reload restores summaries, never the candidate or a stale file edit.
      const laterCode = candidate.replace('11mm', '12mm')
      await page.evaluate(async (code) => {
        const editor = window.app.project?.executingEditor.value
        if (!editor) throw new Error('No editor')
        editor.updateCodeEditor(code, { shouldExecute: false })
        await editor.flushWriteToFile()
      }, laterCode)
      await page.reload()
      await waitForAppLoad(page)
      await toolbar.openPane(DefaultLayoutPaneID.Zookeeper)
      await expect(
        page.getByRole('region', { name: 'Past KCL migration' })
      ).toHaveCount(2)
      await expect(
        page.getByText('Last reported: migration applied.')
      ).toBeVisible()
      await expect.poll(editorCode).toBe(laterCode)
      expect(applicationStates).toEqual(['applied', 'undone', 'applied'])
    })
  }
)
