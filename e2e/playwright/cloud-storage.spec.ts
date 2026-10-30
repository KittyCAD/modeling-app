import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'
import { expect, test } from '@e2e/playwright/base-test'
import { mockClientErrorReports, setup } from '@e2e/playwright/test-utils'
import {
  cloudProjectResponse,
  projectToml,
  zipProject,
  type CloudProject,
} from '@e2e/playwright/lib/cloudProjectTestUtils'
import { decode } from '@msgpack/msgpack'
import type { BrowserContext } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**/ws/modeling/commands**', () => {})
})

const projectId = '12902000-0000-4000-8000-000000000091'

async function mockCloud(context: BrowserContext) {
  const project: CloudProject = {
    id: projectId,
    title: 'Cloud memory model',
    revision: '1',
    files: {
      'main.kcl': '@settings(kclVersion = 3.0)\n',
      'parts/note.md': 'original',
      'project.toml': projectToml('Cloud memory model'),
    },
  }
  const uploads: string[] = []
  await context.route('**/user', (route) =>
    route.fulfill({
      json: {
        id: '12902000-0000-4000-8000-000000000001',
        username: 'playwright',
        name: 'Playwright',
        email: 'playwright@example.com',
        image: '',
        created_at: '2026-09-01T12:00:00Z',
        updated_at: '2026-09-01T12:00:00Z',
      },
    })
  )
  await context.route('**/user/projects**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/user/projects')
      return route.fulfill({
        json: { items: [cloudProjectResponse(project)], next_page: null },
      })
    if (url.pathname.endsWith('/thumbnail'))
      return route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j/1sAAAAASUVORK5CYII=',
          'base64'
        ),
      })
    if (url.pathname.endsWith('/download'))
      return route.fulfill({
        contentType: 'application/zip',
        body: await zipProject(project.files),
      })
    if (request.method() === 'PUT') {
      uploads.push(url.searchParams.get('expected_revision') ?? '')
      if (url.searchParams.get('expected_revision') !== project.revision)
        return route.fulfill({
          status: 409,
          json: { message: 'Revision changed' },
        })
      const body = request.postDataBuffer()
      if (!body) throw new Error('Missing upload body')
      const form = await new Request(request.url(), {
        method: 'POST',
        headers: request.headers(),
        body: new Uint8Array(body).buffer,
      }).formData()
      const files: Record<string, string> = {}
      for (const [name, value] of form.entries()) {
        if (name !== 'body' && typeof value !== 'string')
          files[name] = await value.text()
      }
      project.files = files
      project.revision = String(Number(project.revision) + 1)
    }
    return route.fulfill({ json: cloudProjectResponse(project) })
  })
  return { project, uploads }
}

test(
  'loads current cloud files from a direct modeling URL and after reloading it',
  { tag: '@web' },
  async ({ context, page }, testInfo) => {
    await mockClientErrorReports(context)
    const remote = await mockCloud(context)
    await setup(context, page, testInfo)
    const main = `/__zoo_cloud__/${projectId}/main.kcl`
    remote.project.files['main.kcl'] += '// Direct cloud load\n'
    await page.goto(`/file/${encodeURIComponent(main)}`)
    await expect(page.locator('.cm-content').first()).toContainText(
      'Direct cloud load'
    )
    await expect
      .poll(() => page.evaluate(() => window.app.fileOperations.pending()))
      .toBe(0)
    const initialUploads = remote.uploads.length
    await page.evaluate(() =>
      window.app.settings.actor.send({
        type: 'set.app.theme',
        data: { level: 'user', value: 'dark' },
      })
    )
    await expect
      .poll(() =>
        page.evaluate(() => window.app.settings.actor.getSnapshot().value)
      )
      .toBe('idle')
    expect(remote.uploads).toHaveLength(initialUploads)
    remote.project.files['main.kcl'] =
      '@settings(kclVersion = 3.0)\n// Changed on another device\n'
    remote.project.revision = '2'
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.locator('.cm-content').first()).toContainText(
      'Changed on another device'
    )
  }
)

test(
  'opens, saves, and reloads cloud files without modifying a historical disk mirror',
  { tag: '@web' },
  async ({ context, page }, testInfo) => {
    test.setTimeout(180_000)
    await mockClientErrorReports(context)
    const remote = await mockCloud(context)
    await setup(context, page, testInfo)
    const thumbnailResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/user/projects/${projectId}/thumbnail`) &&
        response.status() === 200
    )
    await page.goto('/home')
    await page.evaluate(async (id) => {
      const root = '/documents/legacy-cloud-mirror'
      await window.fsZds.mkdir(root, { recursive: true })
      await window.fsZds.writeFile(
        `${root}/main.kcl`,
        new TextEncoder().encode('unsynced legacy edit')
      )
      await window.fsZds.writeFile(
        `${root}/project.toml`,
        new TextEncoder().encode(
          `title = "Legacy mirror"\n[cloud."dev.zoo.dev"]\nproject_id = "${id}"\n`
        )
      )
    }, projectId)
    expect(
      (await thumbnailResponse).request().headers().authorization
    ).toBeTruthy()
    const image = page
      .getByTestId('project-link')
      .filter({ has: page.getByText('Cloud memory model', { exact: true }) })
      .locator('img')
    await expect(image).toBeVisible()
    await expect(image).toHaveJSProperty('naturalWidth', 1)
    await page
      .getByTestId('project-link')
      .filter({ has: page.getByText('Cloud memory model', { exact: true }) })
      .click()
    await expect(page).toHaveURL(/__zoo_cloud__.*main\.kcl/)
    const root = `/__zoo_cloud__/${projectId}`
    await page.evaluate(async (root) => {
      await window.app.fileOperations.writeFile(
        `${root}/parts/note.md`,
        'saved cloud edit'
      )
    }, root)
    expect(remote.project.files['parts/note.md']).toBe('saved cloud edit')
    expect(remote.uploads).toContain('1')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/__zoo_cloud__.*main\.kcl/)
    await expect
      .poll(
        () =>
          page.evaluate(async (root) => {
            const path = `${root}/parts/note.md`
            if (!(await window.app.fileOperations.exists(path))) return null
            return new TextDecoder().decode(
              await window.app.fileOperations.readFile(path)
            )
          }, root),
        { timeout: 30_000 }
      )
      .toBe('saved cloud edit')
    expect(
      await page.evaluate(async () =>
        new TextDecoder().decode(
          await window.fsZds.readFile('/documents/legacy-cloud-mirror/main.kcl')
        )
      )
    ).toBe('unsynced legacy edit')
    expect(
      await page.evaluate(async (root) => {
        try {
          await window.fsZds.stat(root)
          return true
        } catch {
          return false
        }
      }, root)
    ).toBe(false)
  }
)

test(
  'combines cloud editor saves with thumbnails and flushes idle thumbnails',
  { tag: '@web' },
  async ({ context, page }, testInfo) => {
    await mockClientErrorReports(context)
    const remote = await mockCloud(context)
    await setup(context, page, testInfo)
    await page.goto('/home')
    await page
      .getByTestId('project-link')
      .filter({ has: page.getByText('Cloud memory model', { exact: true }) })
      .click()
    await expect(page).toHaveURL(/__zoo_cloud__.*main\.kcl/)
    await expect
      .poll(() => page.evaluate(() => window.app.fileOperations.pending()))
      .toBe(0)
    const clockStart = new Date()
    await page.clock.install({ time: clockStart })
    await page.clock.pauseAt(new Date(clockStart.getTime() + 1_000))
    await expect
      .poll(() => page.evaluate(() => window.app.fileOperations.pending()))
      .toBe(0)
    const uploadsBeforeEditing = remote.uploads.length
    const edit = async (comment: string) =>
      page.evaluate((comment) => {
        window.app.singletons.kclManager.updateCodeEditor(
          `@settings(kclVersion = 3.0)\n// ${comment}\n`,
          {
            shouldExecute: false,
            shouldWriteToDisk: true,
            shouldResetCamera: false,
          }
        )
      }, comment)
    await edit('first')
    await page.evaluate(async () => {
      await window.app.projectSession.writeThumbnail(
        window.app.project!.path,
        new TextEncoder().encode('first thumbnail')
      )
    })
    await page.clock.runFor(1_000)
    expect(remote.uploads).toHaveLength(uploadsBeforeEditing)
    await edit('latest')
    await page.clock.runFor(1_499)
    expect(remote.uploads).toHaveLength(uploadsBeforeEditing)
    await page.clock.runFor(1)
    await expect
      .poll(() => remote.project.files['main.kcl'])
      .toContain('// latest')
    await page.clock.runFor(3_000)
    await expect
      .poll(() => page.evaluate(() => window.app.fileOperations.pending()))
      .toBe(0)
    expect(remote.uploads).toHaveLength(uploadsBeforeEditing + 1)
    expect(remote.project.files['thumbnail.png']).toBe('first thumbnail')
    await page.evaluate(async () => {
      await window.app.projectSession.writeThumbnail(
        window.app.project!.path,
        new TextEncoder().encode('idle thumbnail')
      )
    })
    await page.clock.runFor(2_999)
    expect(remote.uploads).toHaveLength(uploadsBeforeEditing + 1)
    await page.clock.runFor(1)
    await expect
      .poll(() => remote.project.files['thumbnail.png'])
      .toBe('idle thumbnail')
    expect(remote.uploads).toHaveLength(uploadsBeforeEditing + 2)
    expect(remote.project.files['.gitignore']).toBeUndefined()
  }
)

test(
  'switches files without waiting for cloud acknowledgement or modeling',
  { tag: '@web' },
  async ({ context, page }, testInfo) => {
    await mockClientErrorReports(context)
    const remote = await mockCloud(context)
    remote.project.files['other.kcl'] =
      '@settings(kclVersion = 3.0)\n// target buffer\n'
    await setup(context, page, testInfo)
    await page.goto('/home')
    await page
      .getByTestId('project-link')
      .filter({ has: page.getByText('Cloud memory model', { exact: true }) })
      .click()
    await expect(page).toHaveURL(/main\.kcl/)
    await page.evaluate(
      (ids) => {
        for (const id of ids) window.app.layout.openPane(id)
      },
      [DefaultLayoutPaneID.Code, DefaultLayoutPaneID.Files]
    )
    const originalProject = await page.evaluateHandle(() => window.app.project)
    const releaseBuffer = await page.evaluateHandle(() => {
      const target = window.app.project?.files.find((file) =>
        file.path.endsWith('/other.kcl')
      )
      if (!target) throw new Error('Missing target file')
      const read = target.read.bind(target)
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      target.read = async () => {
        await gate
        return read()
      }
      return () => {
        target.read = read
        release()
      }
    })
    const save = Promise.withResolvers<undefined>()
    let blockedSave = false
    await context.route('**/user/projects/**', async (route) => {
      if (route.request().method() === 'PUT' && !blockedSave) {
        blockedSave = true
        await save.promise
      }
      await route.fallback()
    })
    const releaseModeling = await page.evaluateHandle(() => {
      const rust = window.app.rustContext
      const original = rust.sendOpenProject.bind(rust)
      const originalUpdate = rust.sendUpdateFile.bind(rust)
      const sourceId = window.app.singletons.kclManager.id
      let updatesBeforeReady = 0
      let ready = false
      rust.sendUpdateFile = async (...args) => {
        if (!ready && args[0] !== sourceId) updatesBeforeReady += 1
        return originalUpdate(...args)
      }
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      rust.sendOpenProject = async (...args) => {
        await gate
        return original(...args)
      }
      return () => {
        rust.sendOpenProject = original
        rust.sendUpdateFile = originalUpdate
        ready = true
        release()
        return updatesBeforeReady
      }
    })
    try {
      await page.evaluate(() =>
        window.app.singletons.kclManager.updateCodeEditor(
          '@settings(kclVersion = 3.0)\n// outgoing edit\n',
          {
            shouldExecute: false,
            shouldWriteToDisk: true,
            shouldResetCamera: false,
          }
        )
      )
      await page
        .getByRole('treeitem', { name: 'other.kcl', exact: true })
        .click()
      await expect(
        page.getByRole('status', { name: 'Loading file' })
      ).toBeVisible()
      await expect(
        page.locator('#code-mirror-override').locator('..')
      ).toHaveAttribute('inert', '')
      await releaseBuffer.evaluate((release) => release())
      await expect(page.locator('.cm-content').first()).toContainText(
        '// target buffer',
        { timeout: 1_500 }
      )
      await expect(
        page.getByRole('status', { name: 'Loading file' })
      ).toBeHidden()
      expect(
        await originalProject.evaluate(
          (project) => window.app.project === project
        )
      ).toBe(true)
      await expect.poll(() => blockedSave).toBe(true)
      await page.evaluate(() =>
        window.app.singletons.kclManager.updateCodeEditor(
          '@settings(kclVersion = 3.0)\n// target buffer edited\n',
          {
            shouldExecute: false,
            shouldWriteToDisk: false,
            shouldSyncRust: true,
          }
        )
      )
      await page
        .getByRole('treeitem', { name: 'main.kcl', exact: true })
        .click()
      await expect(page.locator('.cm-content').first()).toContainText(
        '// outgoing edit',
        { timeout: 1_500 }
      )
    } finally {
      await releaseBuffer.evaluate((release) => release())
      save.resolve(undefined)
      expect(await releaseModeling.evaluate((release) => release())).toBe(0)
    }
    await expect
      .poll(() => remote.project.files['main.kcl'])
      .toContain('// outgoing edit')
    expect(remote.project.files['other.kcl']).toContain('// target buffer')
  }
)

test(
  'cloud MCP returns refresh authoritative files and ignore streamed edit snapshots',
  { tag: ['@web', '@zookeeper'] },
  async ({ context, page }, testInfo) => {
    test.setTimeout(180_000)
    await mockClientErrorReports(context)
    const remote = await mockCloud(context)
    let connected = false
    let send: (message: object) => void = () => {
      throw new Error('Zookeeper socket has not connected')
    }
    await page.routeWebSocket('**/ws/ml/copilot**', (socket) => {
      send = (message) => socket.send(JSON.stringify(message))
      socket.onMessage((message) => {
        const request =
          typeof message === 'string' ? JSON.parse(message) : decode(message)
        if (
          request &&
          typeof request === 'object' &&
          'type' in request &&
          request.type === 'list_modes'
        ) {
          connected = true
          send({
            conversation_id: {
              conversation_id: '12902000-0000-4000-8000-000000000092',
            },
          })
        }
        if (
          request &&
          typeof request === 'object' &&
          'type' in request &&
          request.type === 'ping'
        )
          send({ pong: {} })
      })
    })
    await setup(context, page, testInfo)
    await page.goto('/home')
    await page
      .getByTestId('project-link')
      .filter({ has: page.getByText('Cloud memory model', { exact: true }) })
      .click()
    await expect(page).toHaveURL(/__zoo_cloud__.*main\.kcl/)
    await expect.poll(() => connected, { timeout: 30_000 }).toBe(true)
    await expect
      .poll(() => page.evaluate(() => window.app.fileOperations.pending()))
      .toBe(0)
    const initialUploads = remote.uploads.length
    send({
      tool_output: {
        result: {
          type: 'edit_kcl_code',
          status_code: 200,
          outputs: { 'main.kcl': 'stale snapshot' },
          zookeeper_edit_patch: {
            run_id: 'remote-run',
            changed_files: [
              {
                status: 'modified',
                path: 'main.kcl',
                contents: 'stale snapshot',
              },
            ],
          },
        },
      },
    })
    remote.project.files['main.kcl'] =
      '@settings(kclVersion = 3.0)\nwidth = 42\n'
    remote.project.files['new/data.bin'] = 'binary import'
    delete remote.project.files['parts/note.md']
    remote.project.revision = String(Number(remote.project.revision) + 1)
    send({
      tool_output: {
        result: {
          type: 'project_write_file',
          call_id: 'cloud-write-1',
          project_id: `cloud:${projectId}`,
          ok: true,
          output: cloudProjectResponse(remote.project),
        },
      },
    })
    await expect
      .poll(() => page.evaluate(() => window.app.singletons.kclManager.code), {
        timeout: 30_000,
      })
      .toContain('width = 42')
    const root = `/__zoo_cloud__/${projectId}`
    await expect
      .poll(() =>
        page.evaluate(
          async (root) => ({
            added: await window.app.fileOperations.exists(
              `${root}/new/data.bin`
            ),
            deleted: await window.app.fileOperations.exists(
              `${root}/parts/note.md`
            ),
            id: window.app.project?.projectIORefSignal.value.cloudProjectId,
          }),
          root
        )
      )
      .toEqual({ added: true, deleted: false, id: projectId })
    expect(remote.uploads).toHaveLength(initialUploads)
    delete remote.project.files['main.kcl']
    remote.project.revision = String(Number(remote.project.revision) + 1)
    send({
      tool_output: {
        result: {
          type: 'project_rm',
          call_id: 'cloud-remove-1',
          project_id: `cloud:${projectId}`,
          ok: true,
          output: cloudProjectResponse(remote.project),
        },
      },
    })
    await expect
      .poll(() => page.evaluate(() => window.app.project?.files.length))
      .toBe(0)
    expect(
      await page.evaluate(
        async (root) => window.app.fileOperations.exists(`${root}/main.kcl`),
        root
      )
    ).toBe(false)
    expect(remote.uploads).toHaveLength(initialUploads)
  }
)
