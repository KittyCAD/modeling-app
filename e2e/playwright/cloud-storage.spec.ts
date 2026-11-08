import type { Request } from '@playwright/test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'
import { expect, test } from '@e2e/playwright/base-test'
import { mockClientErrorReports, setup } from '@e2e/playwright/test-utils'
import { mockCloudStorage } from '@e2e/playwright/lib/cloudStorageFixture'
import { cloudProjectResponse } from '@e2e/playwright/lib/cloudProjectTestUtils'
import { decode } from '@msgpack/msgpack'

const projectId = '12902000-0000-4000-8000-000000000091'

test(
  'polls revisions and reflects remote edits and deletions without reloading the page',
  { tag: '@web' },
  async ({ context, page }, testInfo) => {
    await mockClientErrorReports(context)
    const remote = await mockCloudStorage(context)
    await setup(context, page, testInfo)
    const root = `/__zoo_cloud__/${projectId}`
    await page.goto(`/file/${encodeURIComponent(`${root}/main.kcl`)}`)
    await expect(page.locator('.cm-content').first()).toBeVisible()
    await page.evaluate(
      (id) => window.app.layout.openPane(id),
      DefaultLayoutPaneID.Files
    )
    const clockStart = new Date()
    await page.clock.install({ time: clockStart })
    await page.clock.pauseAt(new Date(clockStart.getTime() + 1_000))
    const initialReads = { ...remote.reads }
    await page.clock.runFor(8_000)
    await expect
      .poll(() => remote.reads.metadata)
      .toBeGreaterThan(initialReads.metadata)
    expect(remote.reads.downloads).toBe(initialReads.downloads)

    remote.project.files['main.kcl'] =
      '@settings(kclVersion = 3.0)\n// edited from another client\n'
    remote.project.files['new.kcl'] =
      '@settings(kclVersion = 3.0)\n// new remote file\n'
    remote.project.revision = 'remote-edit'
    // Refocusing performs an immediate check even after backing off.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.clock.runFor(1)
    await expect(page.locator('.cm-content').first()).toContainText(
      'edited from another client'
    )
    await expect(
      page.getByRole('treeitem', { name: 'new.kcl', exact: true })
    ).toBeVisible()
    expect(remote.reads.downloads).toBe(initialReads.downloads + 1)
    const metadataAfterChange = remote.reads.metadata
    await page.clock.runFor(4_000)
    await expect
      .poll(() => remote.reads.metadata)
      .toBeGreaterThan(metadataAfterChange)

    await page.getByRole('treeitem', { name: 'new.kcl', exact: true }).click()
    await expect(page).toHaveURL(/new\.kcl/)
    delete remote.project.files['new.kcl']
    remote.project.revision = 'remote-delete'
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.clock.runFor(1)
    await expect(page).toHaveURL(/main\.kcl/)
    await expect(
      page.getByRole('treeitem', { name: 'new.kcl', exact: true })
    ).not.toBeVisible()

    await page.getByRole('treeitem', { name: 'parts', exact: true }).click()
    await page.getByRole('treeitem', { name: 'note.md', exact: true }).click()
    await expect(page.locator('#code-pane').getByRole('textbox')).toContainText(
      'original'
    )
    remote.project.files['parts/note.md'] = 'text changed on another client'
    remote.project.revision = 'remote-text'
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.clock.runFor(1)
    await expect(page.locator('#code-pane').getByRole('textbox')).toContainText(
      'text changed on another client'
    )
  }
)

test(
  'keeps repeated remote updates responsive while rebuilding the modeling snapshot',
  { tag: '@web' },
  async ({ context, page }, testInfo) => {
    await mockClientErrorReports(context)
    const remote = await mockCloudStorage(context)
    await setup(context, page, testInfo)
    await page.goto(
      `/file/${encodeURIComponent(`/__zoo_cloud__/${projectId}/main.kcl`)}`
    )
    await expect(page.locator('.cm-content').first()).toBeVisible()
    const release = await page.evaluateHandle(() => {
      const project = window.app.project
      if (!project) throw new Error('Missing project')
      const original = project.reloadFilesFromStorage.bind(project)
      const gate = Promise.withResolvers<undefined>()
      project.reloadFilesFromStorage = async (...args) => {
        await gate.promise
        return original(...args)
      }
      return () => {
        project.reloadFilesFromStorage = original
        gate.resolve(undefined)
      }
    })
    try {
      remote.project.files['main.kcl'] =
        '@settings(kclVersion = 3.0)\n// first external save\n'
      remote.project.revision = 'save-1'
      const firstDownload = remote.reads.downloads + 1
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await expect.poll(() => remote.reads.downloads).toBe(firstDownload)
      await page.clock.install()
      for (let save = 2; save <= 3; save++) {
        remote.project.files['main.kcl'] =
          `@settings(kclVersion = 3.0)\n// external save ${save}\n`
        remote.project.revision = `save-${save}`
        // Keep the rebuild blocked through seven seconds of browser time.
        await page.clock.fastForward(7_000)
        // New remote revisions must remain observable while Rust rebuilding is blocked.
        await expect
          .poll(() => remote.reads.downloads, {
            timeout: 10_000,
            intervals: [50],
          })
          .toBe(firstDownload + save - 1)
      }
      await release.evaluate((restore) => restore())
      await expect(page.locator('.cm-content').first()).toContainText(
        'external save 3'
      )
    } finally {
      await release.evaluate((restore) => restore())
    }
  }
)

test(
  'pauses cloud polling while hidden or offline and checks immediately on return',
  { tag: '@web' },
  async ({ context, page }, testInfo) => {
    const metadataRequests = new Set<Request>()
    page.on('request', (request) => {
      if (
        request.method() === 'GET' &&
        new URL(request.url()).pathname === `/user/projects/${projectId}`
      ) {
        metadataRequests.add(request)
      }
    })
    page.on('requestfinished', (request) => metadataRequests.delete(request))
    page.on('requestfailed', (request) => metadataRequests.delete(request))
    await mockClientErrorReports(context)
    const remote = await mockCloudStorage(context)
    await setup(context, page, testInfo)
    await page.goto(
      `/file/${encodeURIComponent(`/__zoo_cloud__/${projectId}/main.kcl`)}`
    )
    await expect(page.locator('.cm-content').first()).toBeVisible()
    const clockStart = new Date()
    await page.clock.install({ time: clockStart })
    await page.clock.pauseAt(new Date(clockStart.getTime() + 1_000))
    for (const state of ['hidden', 'offline']) {
      await page.evaluate((state) => {
        if (state === 'hidden') {
          Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'hidden',
          })
          document.dispatchEvent(new Event('visibilitychange'))
        } else {
          Object.defineProperty(navigator, 'onLine', {
            configurable: true,
            value: false,
          })
          window.dispatchEvent(new Event('offline'))
        }
      }, state)
      // Allow a probe that was already in flight to settle before counting.
      await expect.poll(() => metadataRequests.size).toBe(0)
      const before = remote.reads.metadata
      await page.clock.runFor(120_000)
      expect(remote.reads.metadata).toBe(before)
      await page.evaluate((state) => {
        if (state === 'hidden') {
          Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'visible',
          })
          document.dispatchEvent(new Event('visibilitychange'))
        } else {
          Object.defineProperty(navigator, 'onLine', {
            configurable: true,
            value: true,
          })
          window.dispatchEvent(new Event('online'))
        }
      }, state)
      await page.clock.runFor(1)
      await expect.poll(() => remote.reads.metadata).toBeGreaterThan(before)
    }
  }
)

test(
  'detects remote revisions during Zookeeper work or unsaved edits and applies them when safe',
  { tag: '@web' },
  async ({ context, page }, testInfo) => {
    await mockClientErrorReports(context)
    const remote = await mockCloudStorage(context)
    await setup(context, page, testInfo)
    await page.goto(
      `/file/${encodeURIComponent(`/__zoo_cloud__/${projectId}/main.kcl`)}`
    )
    await expect(page.locator('.cm-content').first()).toBeVisible()
    const promptState = await page.evaluateHandle(async () => {
      const modulePath = '/src/lib/zookeeper/zookeeperPromptState.ts'
      const { zookeeperPromptRunningSignal } = await import(modulePath)
      return zookeeperPromptRunningSignal
    })
    await promptState.evaluate((state) => {
      state.value = true
    })
    remote.project.files['main.kcl'] =
      '@settings(kclVersion = 3.0)\n// remote while busy\n'
    remote.project.revision = 'remote-busy'
    const initialDownloads = remote.reads.downloads
    const initialMetadata = remote.reads.metadata
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect
      .poll(() => remote.reads.metadata)
      .toBeGreaterThan(initialMetadata)
    expect(remote.reads.downloads).toBe(initialDownloads)
    await expect(page.locator('.cm-content').first()).not.toContainText(
      'remote while busy'
    )
    await promptState.evaluate((state) => {
      state.value = false
    })
    await expect(page.locator('.cm-content').first()).toContainText(
      'remote while busy'
    )

    await page.evaluate(() =>
      window.app.singletons.kclManager.updateCodeEditor(
        '@settings(kclVersion = 3.0)\n// unsaved local edits\n',
        {
          shouldExecute: false,
          shouldWriteToDisk: false,
          shouldResetCamera: false,
        }
      )
    )
    remote.project.files['main.kcl'] =
      '@settings(kclVersion = 3.0)\n// competing remote edits\n'
    remote.project.revision = 'remote-dirty'
    const before = { ...remote.reads }
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect
      .poll(() => remote.reads.metadata)
      .toBeGreaterThan(before.metadata)
    expect(remote.reads.downloads).toBe(before.downloads)
    await expect(page.locator('.cm-content').first()).toContainText(
      'unsaved local edits'
    )
  }
)

for (const kind of ['file', 'directory']) {
  test(
    `deletes a cloud ${kind} using the parent revision without a local archive`,
    { tag: '@web' },
    async ({ context, page }, testInfo) => {
      await mockClientErrorReports(context)
      const remote = await mockCloudStorage(context)
      remote.project.files['parts/handle.kcl'] =
        '@settings(kclVersion = 3.0)\n// handle\n'
      await setup(context, page, testInfo)
      const root = `/__zoo_cloud__/${projectId}`
      await page.goto(`/file/${encodeURIComponent(`${root}/main.kcl`)}`)
      await expect(page.locator('.cm-content').first()).toBeVisible()
      await page.evaluate(
        (id) => window.app.layout.openPane(id),
        DefaultLayoutPaneID.Files
      )
      const parts = page.getByRole('treeitem', { name: 'parts', exact: true })
      await parts.click()
      const handle = page.getByRole('treeitem', {
        name: 'handle.kcl',
        exact: true,
      })
      // Exercise navigation when deleting the executing file or its parent folder.
      await handle.click()
      await expect(page).toHaveURL(/handle\.kcl/)
      const history = await page.evaluateHandle(() => {
        const manager = window.app.singletons.kclManager
        const original = manager.addGlobalHistoryEvent.bind(manager)
        let recorded = 0
        manager.addGlobalHistoryEvent = (...args) => {
          recorded += 1
          return original(...args)
        }
        return {
          count: () => recorded,
          restore: () => {
            manager.addGlobalHistoryEvent = original
          },
        }
      })
      const target = kind === 'file' ? handle : parts
      try {
        await target.click({ button: 'right' })
        await page.getByTestId('context-menu-delete').click()
        await page.getByTestId('delete-confirmation').click()
        await expect(target).not.toBeVisible()
        await expect(page).toHaveURL(/main\.kcl/)
        await expect.poll(() => remote.deletions.length).toBe(1)
        expect(remote.deletions[0].paths.toSorted()).toEqual(
          (kind === 'file'
            ? ['parts/handle.kcl']
            : ['parts/handle.kcl', 'parts/note.md']
          ).toSorted()
        )
        expect(remote.uploads).toContain(remote.deletions[0].parentRevision)
        expect(remote.project.files['main.kcl']).toBe(
          '@settings(kclVersion = 3.0)\n'
        )
        expect(await history.evaluate((h) => h.count())).toBe(0)
        expect(
          await page.evaluate(async () => {
            const storage = await navigator.storage.getDirectory()
            try {
              const userData = await storage.getDirectoryHandle('userData')
              const archive = await userData.getDirectoryHandle('archive')
              await archive.getDirectoryHandle('__zoo_cloud__')
              return true
            } catch (error) {
              if (
                error instanceof DOMException &&
                error.name === 'NotFoundError'
              )
                return false
              throw error
            }
          })
        ).toBe(false)
        await page.reload({ waitUntil: 'domcontentloaded' })
        await expect(page.locator('.cm-content').first()).toBeVisible()
        await expect
          .poll(() =>
            page.evaluate(
              (path) => window.app.fileOperations.exists(path),
              `${root}/${kind === 'file' ? 'parts/handle.kcl' : 'parts'}`
            )
          )
          .toBe(false)
      } finally {
        // The page may have reloaded, replacing the captured manager.
        await history.evaluate((h) => h.restore()).catch(() => {})
      }
    }
  )
}

test(
  'keeps the local archive and undo history for local file deletion',
  { tag: '@web' },
  async ({ context, page }, testInfo) => {
    await mockClientErrorReports(context)
    await mockCloudStorage(context)
    await setup(context, page, testInfo)
    await page.goto('/home')
    await expect(page.getByTestId('project-link').first()).toBeVisible()
    const root = await page.evaluate(async () => {
      const fs = window.fsZds
      const root = fs.join(window.app.projectDirectoryPath, 'local-delete')
      await fs.mkdir(root, { recursive: true })
      await fs.writeFile(
        fs.join(root, 'main.kcl'),
        new TextEncoder().encode('@settings(kclVersion = 3.0)\n')
      )
      await fs.writeFile(
        fs.join(root, 'note.md'),
        new TextEncoder().encode('local backup contents')
      )
      return root
    })
    await page.goto(`/file/${encodeURIComponent(`${root}/main.kcl`)}`)
    await expect(page.locator('.cm-content').first()).toBeVisible()
    await page.evaluate(
      (id) => window.app.layout.openPane(id),
      DefaultLayoutPaneID.Files
    )
    const note = page.getByRole('treeitem', { name: 'note.md', exact: true })
    const historyBefore = await page.evaluate(
      () => window.app.singletons.kclManager.globalHistoryView.undoDepth
    )
    await note.click({ button: 'right' })
    await page.getByTestId('context-menu-delete').click()
    await page.getByTestId('delete-confirmation').click()
    await expect(note).not.toBeVisible()
    expect(
      await page.evaluate(
        async (root) =>
          new TextDecoder().decode(
            await window.fsZds.readFile(
              window.fsZds.join('/userData/archive', root, 'note.md')
            )
          ),
        root
      )
    ).toBe('local backup contents')
    expect(
      await page.evaluate(
        () => window.app.singletons.kclManager.globalHistoryView.undoDepth
      )
    ).toBe(historyBefore + 1)
  }
)

test(
  'opens, saves, and reloads cloud files without modifying a historical disk mirror',
  { tag: '@web' },
  async ({ context, page }, testInfo) => {
    test.setTimeout(180_000)
    await mockClientErrorReports(context)
    const remote = await mockCloudStorage(context)
    await setup(context, page, testInfo)
    let thumbnailAuthenticated = false
    page.on('response', (response) => {
      if (
        response.url().endsWith(`/user/projects/${projectId}/thumbnail`) &&
        response.status() === 200
      )
        thumbnailAuthenticated = Boolean(
          response.request().headers().authorization
        )
    })
    await page.goto('/home')
    await expect(page.getByTestId('home-header')).toBeVisible({
      timeout: 30_000,
    })
    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading).toHaveText(
      /^(Project Libraries|Personal Cloud|Projects)$/
    )
    if ((await heading.innerText()) === 'Project Libraries') {
      await page
        .getByRole('link', { name: 'Open Personal Cloud library', exact: true })
        .click()
    }
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
    await expect.poll(() => thumbnailAuthenticated).toBe(true)
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
    const remote = await mockCloudStorage(context)
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
    const remote = await mockCloudStorage(context)
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
    const remote = await mockCloudStorage(context)
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
    // A save temporarily unwatches the editor; refresh must still apply its source.
    await page.evaluate(() => window.app.singletons.kclManager.unwatch())
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
