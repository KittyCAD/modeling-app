import {
  readEditorCode,
  expandFileTreeFolder,
  holdFileRead,
  holdModelingOpen,
  holdEditorWrites,
} from '@e2e/playwright/lib/editorTestUtils'
import { CmdBarFixture } from '@e2e/playwright/fixtures/cmdBarFixture'
import { expect, test as appTest } from '@e2e/playwright/zoo-test'
import { test as browserTest } from '@e2e/playwright/base-test'
import { ToolbarFixture } from '@e2e/playwright/fixtures/toolbarFixture'
import { SceneFixture } from '@e2e/playwright/fixtures/sceneFixture'
import { doAndWaitForImageDiff } from '@e2e/playwright/test-utils'
import { uploadedProject } from '@e2e/playwright/lib/cloudStorageFixture'
import type { HomePageFixture } from '@e2e/playwright/fixtures/homePageFixture'
import type { Page } from '@playwright/test'
import { prepareStorage } from '@e2e/playwright/lib/projectStorageFixture'
import {
  openLayoutPanes,
  installPausedClock,
  pauseAppClock,
} from '@e2e/playwright/lib/appTestUtils'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

// Browser-local storage is OPFS; desktop-local storage uses Electron's filesystem.
const test = process.env.TARGET === 'web' ? browserTest : appTest

const blankCode = '@settings(kclVersion = 3.0)\n'
const solidCode = `${blankCode}profile = sketch(on = XY) {
  line(start = [0mm, 0mm], end = [20mm, 0mm])
  line(start = [20mm, 0mm], end = [20mm, 20mm])
  line(start = [20mm, 20mm], end = [0mm, 20mm])
  line(start = [0mm, 20mm], end = [0mm, 0mm])
}
section = region(point = [10mm, 10mm], sketch = profile)
body = extrude(section, length = 10mm)
`

async function openExistingSketch(toolbar: ToolbarFixture, name: string) {
  await toolbar.openFeatureTreePane()
  await (await toolbar.getFeatureTreeOperation(name, 0)).dblclick()
  await expect(toolbar.exitSketchBtn).toBeEnabled()
}

async function flushEditorAndThumbnailSaves(page: Page) {
  await page.evaluate(() => window.app.singletons.kclManager.flushWriteToFile())
  await installPausedClock(page)
  await page.clock.runFor(7_000)
  await page.clock.resume()
  await expect(
    page
      .locator('#statusbar')
      .getByRole('status')
      .filter({ hasText: 'Saving...' })
  ).not.toBeAttached()
}

async function createThroughHome(
  page: Page,
  home: HomePageFixture,
  title?: string
) {
  await home.projectsLoaded()
  await home.projectButtonNew.click()
  if (title !== undefined) await home.projectTextName.fill(title)
  await home.projectButtonContinue.click()
  await expect(page).toHaveURL(/\/file\/.*main\.kcl$/)
  await expect(page.locator('.cm-content').first()).toBeVisible()
  const root = await page.evaluate(() => window.app.project?.path)
  if (!root) throw new Error('Created project did not open')
  return root
}

async function editThroughUI(page: Page, code: string) {
  await page.locator('.cm-content').first().click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(code)
}

async function expectEditor(page: Page, code: string) {
  await expect(page.locator('.cm-content').first()).toHaveText(code, {
    useInnerText: true,
  })
}

test('keeps the modeling viewport stable when the save status changes @web', async ({
  page,
  context,
}, testInfo) => {
  const storage = await prepareStorage('local', page, context, testInfo, {
    modeling: true,
  })
  await storage.seedAndOpen('Stable save status', solidCode)
  await new SceneFixture(page).settled()
  await page.evaluate(() => window.app.singletons.kclManager.flushWriteToFile())
  const stream = page.getByTestId('stream')
  const header = page.getByTestId('app-header')
  const statusBar = page.locator('#statusbar')
  const originalHeader = await header.boundingBox()
  const originalStream = await stream.boundingBox()
  const video = await page.locator('#video-stream').elementHandle()
  for (const state of ['saving', 'failed', 'saved'] as const) {
    await page.evaluate((state) => {
      window.app.singletons.kclManager.saveState.value = state
    }, state)
    if (state === 'saving')
      await expect(
        statusBar.getByRole('status').filter({ hasText: 'Saving...' })
      ).toBeVisible()
    if (state === 'failed')
      await expect(
        statusBar.getByRole('button', { name: 'Save failed. Retry' })
      ).toBeVisible()
    if (state === 'saved')
      await expect(statusBar.getByRole('status')).not.toBeAttached()
    expect(await header.boundingBox(), state).toEqual(originalHeader)
    expect(await stream.boundingBox(), state).toEqual(originalStream)
    expect(
      await video?.evaluate(
        (node) => node === document.getElementById('video-stream')
      ),
      state
    ).toBe(true)
  }
})

test('polls cloud project membership, pauses offline and stops outside the projects view @web', async ({
  page,
  context,
}, testInfo) => {
  const storage = await prepareStorage('cloud', page, context, testInfo)
  await storage.seed('Original cloud project', blankCode)
  await storage.refresh()
  const card = (title: string) =>
    storage.home.projectCard.filter({ hasText: title })
  await expect(card('Original cloud project')).toBeVisible()
  await installPausedClock(page)
  const listRoute = /\/user\/projects(?:\?.*)?$/
  let requests = 0
  await context.route(listRoute, async (route) => {
    requests++
    await route.fallback()
  })
  try {
    await storage.seed('Added on another device', blankCode)
    await page.clock.runFor(2_000)
    await expect(card('Added on another device')).toBeVisible()
    const remote = storage.remote.projects.findIndex(
      (project) => project.title === 'Original cloud project'
    )
    storage.remote.projects.splice(remote, 1)
    await page.clock.runFor(2_000)
    await expect(card('Original cloud project')).not.toBeAttached()
    await context.setOffline(true)
    await page.waitForFunction(() => !navigator.onLine)
    await expect(
      page.getByRole('button', { name: 'Refresh projects' })
    ).toBeEnabled()
    const beforeOffline = requests
    await page.clock.runFor(7_000)
    expect(requests).toBe(beforeOffline)
    await context.setOffline(false)
    await page.clock.runFor(0)
    await expect.poll(() => requests).toBeGreaterThan(beforeOffline)
    await page.clock.resume()
    await storage.home.openProject('Added on another device')
    await expectEditor(page, blankCode)
    const afterLeaving = requests
    await pauseAppClock(page)
    await page.clock.runFor(7_000)
    expect(requests).toBe(afterLeaving)
  } finally {
    await context.setOffline(false)
    await page.clock.resume()
    await context.unroute(listRoute)
  }
})

test(
  'shows loading feedback while listing and opening cloud projects',
  { tag: '@web' },
  async ({ page, context }, testInfo) => {
    const storage = await prepareStorage('cloud', page, context, testInfo)
    await storage.seed('Slow project', blankCode)
    await storage.refresh()
    const listing = Promise.withResolvers<undefined>()
    const opening = Promise.withResolvers<undefined>()
    // Record transient empty states too; polling after the request starts misses them.
    await page.addInitScript(() => {
      new MutationObserver((records) => {
        for (const record of records)
          for (const node of record.addedNodes)
            if (
              node instanceof Element &&
              (node.matches('[data-testid="projects-none"]') ||
                node.querySelector('[data-testid="projects-none"]'))
            )
              document.documentElement.dataset.emptyProjectsFlash = 'true'
      }).observe(document, { childList: true, subtree: true })
    })
    const listRoute = /\/user\/projects(?:\?.*)?$/
    let listingStarted = false
    let openingStarted = false
    await context.route(listRoute, async (route) => {
      listingStarted = true
      await listing.promise
      await route.fallback()
    })
    await context.route('**/user/projects/**/download?*', async (route) => {
      openingStarted = true
      await opening.promise
      await route.fallback()
    })
    try {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect.poll(() => listingStarted).toBe(true)
      expect(
        await page.evaluate(
          () => document.documentElement.dataset.emptyProjectsFlash
        )
      ).toBeUndefined()
      const listSpinner = page.getByRole('status', {
        name: 'Loading projects',
        exact: true,
      })
      await expect(listSpinner).toBeVisible()
      await installPausedClock(page)
      await page.clock.runFor(7_000)
      await expect(listSpinner).toBeVisible()
      await page.screenshot({
        path: testInfo.outputPath('project-list-loading.png'),
      })
      await expect(page.getByTestId('projects-none')).not.toBeVisible()
      listing.resolve(undefined)
      await page.clock.resume()
      await expect(listSpinner).not.toBeVisible()
      await storage.home.openProject('Slow project')
      await expect.poll(() => openingStarted).toBe(true)
      const cardSpinner = page.getByRole('status', {
        name: 'Opening project Slow project',
        exact: true,
      })
      await expect(cardSpinner).toBeVisible()
      await pauseAppClock(page)
      await page.clock.runFor(7_000)
      await expect(cardSpinner).toBeVisible()
      await page.screenshot({
        path: testInfo.outputPath('project-card-loading.png'),
      })
      opening.resolve(undefined)
      await page.clock.resume()
      await expectEditor(page, blankCode)
      await expect(cardSpinner).not.toBeAttached()
    } finally {
      listing.resolve(undefined)
      opening.resolve(undefined)
      await page.clock.resume()
      await context.unroute(listRoute)
      await context.unroute('**/user/projects/**/download?*')
    }
  }
)

for (const workerWrites of [false, true]) {
  test(
    `${workerWrites ? 'saves' : 'reads'} browser-local files through a worker while offline`,
    { tag: '@web' },
    async ({ page, context }, testInfo) => {
      test.skip(process.env.TARGET !== 'web', 'OPFS is browser storage')
      await context.addInitScript((workerWrites) => {
        if (workerWrites && typeof FileSystemFileHandle !== 'undefined')
          Object.defineProperty(
            FileSystemFileHandle.prototype,
            'createWritable',
            {
              configurable: true,
              value: undefined,
            }
          )
        // Model WebKit's offline OPFS blobs while keeping the real filesystem and worker.
        for (const method of ['text', 'arrayBuffer'] as const) {
          const read: () => Promise<string | ArrayBuffer> =
            File.prototype[method]
          Object.defineProperty(File.prototype, method, {
            configurable: true,
            value: function (this: File) {
              if (!navigator.onLine)
                return Promise.reject(
                  new DOMException('Offline blob', 'NotReadableError')
                )
              return read.call(this)
            },
          })
        }
      }, workerWrites)
      const storage = await prepareStorage('local', page, context, testInfo)
      const root = await storage.seed('Offline worker', blankCode)
      await storage.refresh()
      await storage.home.openProject('Offline worker')
      await expectEditor(page, blankCode)
      await page.waitForLoadState('networkidle')
      const code = `${blankCode}// saved by the offline worker\n`
      try {
        await context.setOffline(true)
        await page.waitForTimeout(7_000)
        await editThroughUI(page, code)
        await expect.poll(() => storage.read(root)).toBe(code)
      } finally {
        await context.setOffline(false)
      }
      await storage.refresh()
      await expectEditor(page, code)
    }
  )
}

test('keeps newer cloud edits when a rejected upload already matches the cloud', async ({
  page,
  context,
}, testInfo) => {
  const storage = await prepareStorage('cloud', page, context, testInfo)
  const root = await storage.seed('Already uploaded', blankCode)
  await storage.refresh()
  await storage.home.openProject('Already uploaded')
  await expectEditor(page, blankCode)
  const gate = Promise.withResolvers<undefined>()
  let started = false
  await context.route('**/user/projects/*', async (route) => {
    if (route.request().method() !== 'PUT' || started) return route.fallback()
    started = true
    const upload = await uploadedProject(route)
    const project = storage.remote.projects.find((project) =>
      root.endsWith(project.id)
    )
    if (!project) throw new Error('Missing cloud project')
    project.files = upload.files
    project.revision = String(Number(project.revision) + 1)
    await gate.promise
    await route.fulfill({ status: 409, json: { message: 'Already uploaded' } })
  })
  const first = `${blankCode}width = 10\n`
  const newer = `${blankCode}width = 20\n`
  try {
    await editThroughUI(page, first)
    await expect.poll(() => started).toBe(true)
    await editThroughUI(page, newer)
    await installPausedClock(page)
    await page.clock.runFor(7_000)
    await expectEditor(page, newer)
    gate.resolve(undefined)
    await page.clock.resume()
    await expect.poll(() => storage.read(root)).toBe(newer)
    await expectEditor(page, newer)
    await expect(
      page.getByText('This project changed in the cloud.', { exact: false })
    ).not.toBeVisible()
  } finally {
    gate.resolve(undefined)
    await page.clock.resume()
  }
})

// Both implementations execute the same actions and UI assertions. Naming policy
// and persistence inspection are the explicit implementation-specific boundaries.
for (const kind of ['local', 'cloud'] as const) {
  test.describe(
    `${kind} project workflow contract`,
    { tag: ['@web', '@desktop'] },
    () => {
      test('refreshes the project list and keeps existing cards', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo)
        await storage.seed('Original project', blankCode)
        await storage.refresh()
        const card = (title: string) =>
          storage.home.projectCard.filter({ hasText: title })
        await expect(card('Original project')).toBeVisible()
        const gate = Promise.withResolvers<undefined>()
        let started = false
        const listRoute = /\/user\/projects(?:\?.*)?$/
        const button = page.getByRole('button', { name: 'Refresh projects' })
        await expect(button).toBeEnabled()
        if (kind === 'cloud') {
          await installPausedClock(page)
          await context.route(listRoute, async (route) => {
            started = true
            await gate.promise
            await route.fallback()
          })
        }
        try {
          await storage.seed('Added project', blankCode)
          await button.click()
          if (kind === 'cloud') {
            await expect.poll(() => started).toBe(true)
            await expect(button).toBeDisabled()
            await expect(button).toHaveAttribute('aria-busy', 'true')
            await page.clock.runFor(7_000)
            await expect(button).toBeDisabled()
            await expect(card('Original project')).toBeVisible()
            gate.resolve(undefined)
            await page.clock.resume()
          }
          await expect(card('Added project')).toBeVisible()
          await expect(button).toBeEnabled()
          await expect(card('Original project')).toBeVisible()
        } finally {
          gate.resolve(undefined)
          if (kind === 'cloud') {
            await context.unroute(listRoute)
            await page.clock.resume()
          }
        }
      })

      test('adds a shape to a sketch that already contains a line', async ({
        page,
        context,
      }, testInfo) => {
        test.setTimeout(180_000)
        const missingArtifacts: string[] = []
        page.on('console', (message) => {
          if (
            message.type() === 'error' &&
            message.text().includes('No artifact found with key')
          )
            missingArtifacts.push(message.text())
        })
        const storage = await prepareStorage(kind, page, context, testInfo, {
          modeling: true,
        })
        const scene = new SceneFixture(page)
        const toolbar = new ToolbarFixture(page)
        const initialCode = `${blankCode}profile = sketch(on = XY) {\n  line(start = [var 0mm, var 0mm], end = [var 2mm, var 2mm])\n}\n`
        const root = await storage.seed('Existing sketch', initialCode)
        await storage.refresh()
        await storage.home.openProject('Existing sketch')
        await scene.settled()
        await openExistingSketch(toolbar, 'profile')
        await page.getByTestId('point').click()
        const [click] = scene.makeMouseHelpers(0.7, 0.65, { format: 'ratio' })
        await click()
        await expect.poll(() => storage.read(root)).toContain('point(')
        await expect.poll(() => storage.read(root)).toContain('line(')
        await toolbar.lineBtn.click()
        const [startLine] = scene.makeMouseHelpers(0.3, 0.35, {
          format: 'ratio',
        })
        const [endLine] = scene.makeMouseHelpers(0.4, 0.7, { format: 'ratio' })
        await startLine()
        await expect(
          page.locator('[data-handle="sketch-point-handle"]')
        ).toHaveCount(5)
        await endLine()
        await page.keyboard.press('Escape')
        await expect
          .poll(
            async () =>
              (await storage.read(root))?.match(/line\(/g)?.length ?? 0
          )
          .toBe(2)
        expect(missingArtifacts).toEqual([])
      })

      test('disables Exit Sketch immediately and throughout slow cleanup and engine handoff', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo, {
          modeling: true,
        })
        const scene = new SceneFixture(page)
        const toolbar = new ToolbarFixture(page)
        await storage.seed(
          'Slow sketch exit',
          `${blankCode}profile = sketch(on = XY) {
  line(start = [var 0mm, var 0mm], end = [var 2mm, var 2mm])
}
`
        )
        await storage.refresh()
        await storage.home.openProject('Slow sketch exit')
        await scene.settled()
        await openExistingSketch(toolbar, 'profile')
        await expect(
          page.locator('[data-handle="sketch-point-handle"]')
        ).toHaveCount(2)
        const pending = await page.evaluateHandle(() => {
          const editor = window.app.singletons.kclManager
          const rust = editor.rustContext
          const exitSketch = rust.exitSketch
          const executeCode = editor.executeCode
          const exit = Promise.withResolvers<undefined>()
          const execution = Promise.withResolvers<undefined>()
          let exitCalls = 0
          let executing = false
          rust.exitSketch = async (...args) => {
            exitCalls++
            await exit.promise
            return exitSketch.apply(rust, args)
          }
          editor.executeCode = async (...args) => {
            executing = true
            await execution.promise
            return executeCode.apply(editor, args)
          }
          return {
            exitCalls: () => exitCalls,
            executing: () => executing,
            releaseExit: () => exit.resolve(undefined),
            releaseExecution: () => execution.resolve(undefined),
            restore: () => {
              rust.exitSketch = exitSketch
              editor.executeCode = executeCode
            },
          }
        })
        await page.clock.install()
        try {
          await toolbar.exitSketchBtn.click()
          await expect
            .poll(() => pending.evaluate((p) => p.exitCalls()))
            .toBe(1)
          await expect(toolbar.exitSketchBtn).toBeDisabled()
          await pauseAppClock(page)
          await page.clock.runFor(7_000)
          await expect(toolbar.exitSketchBtn).toBeDisabled()
          expect(
            await page.evaluate(
              () => window.app.singletons.kclManager.isExecuting
            )
          ).toBe(false)
          await page.clock.resume()
          await pending.evaluate((p) => p.releaseExit())
          await expect
            .poll(() => pending.evaluate((p) => p.executing()))
            .toBe(true)
          // The child has finished cleanup, but the parent still owns the exit.
          await expect(toolbar.exitSketchBtn).toBeDisabled()
          await pauseAppClock(page)
          await page.clock.runFor(7_000)
          await expect(toolbar.exitSketchBtn).toBeDisabled()
          expect(await pending.evaluate((p) => p.exitCalls())).toBe(1)
          await page.clock.resume()
          await pending.evaluate((p) => p.releaseExecution())
          await expect(toolbar.exitSketchBtn).not.toBeVisible()
          await expect(toolbar.startSketchBtn).toBeEnabled()
        } finally {
          await page.clock.resume()
          await pending.evaluate((p) => {
            p.releaseExit()
            p.releaseExecution()
            p.restore()
          })
          await pending.dispose()
        }
      })

      test('previews circle code before the radius click without saving unfinished circles', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo, {
          modeling: true,
        })
        const scene = new SceneFixture(page)
        const toolbar = new ToolbarFixture(page)
        const initialCode = `${blankCode}profile = sketch(on = XY) {\n  line(start = [var 0mm, var 0mm], end = [var 2mm, var 2mm])\n}\n`
        const root = await storage.seedAndOpen('Circle live code', initialCode)
        await scene.settled()
        await openExistingSketch(toolbar, 'profile')
        await page.evaluate(() =>
          window.app.singletons.kclManager.flushWriteToFile()
        )
        const before = await storage.read(root)
        const code = () => readEditorCode(page)
        const [center] = scene.makeMouseHelpers(0.35, 0.35, { format: 'ratio' })
        const [radius, moveRadius] = scene.makeMouseHelpers(0.6, 0.6, {
          format: 'ratio',
        })
        const [, moveFurther] = scene.makeMouseHelpers(0.7, 0.7, {
          format: 'ratio',
        })
        await toolbar.circleBtn.click()
        await center()
        await moveRadius()
        await expect.poll(code).toContain('circle(')
        const firstPreview = await code()
        await moveFurther()
        await expect.poll(code).not.toBe(firstPreview)
        await installPausedClock(page)
        await page.clock.runFor(7_000)
        expect(await storage.read(root)).toBe(before)
        await page.clock.resume()
        await page.keyboard.press('Escape')
        await expect.poll(code).not.toContain('circle(')
        expect(await storage.read(root)).toBe(before)
        await toolbar.circleBtn.click()
        await center()
        await moveRadius()
        await expect.poll(code).toContain('circle(')
        await radius()
        await expect.poll(() => storage.read(root)).toContain('circle(')
        await page.keyboard.press('Escape')
        await expect
          .poll(
            async () =>
              (await storage.read(root))?.match(/circle\(/g)?.length ?? 0
          )
          .toBe(1)
        const undo = page.getByRole('button', { name: /^arrow turn left\b/ })
        const redo = page.getByRole('button', { name: /^arrow turn right\b/ })
        await undo.click()
        await expect.poll(code).not.toContain('circle(')
        await expect.poll(() => storage.read(root)).not.toContain('circle(')
        await redo.click()
        await expect.poll(() => storage.read(root)).toContain('circle(')
      })

      test('shows new sketch geometry and coalesces saves while persistence takes seven seconds', async ({
        page,
        context,
      }, testInfo) => {
        test.setTimeout(180_000)
        const storage = await prepareStorage(kind, page, context, testInfo, {
          modeling: true,
        })
        const scene = new SceneFixture(page)
        const toolbar = new ToolbarFixture(page)
        const initialCode = `${blankCode}profile = sketch(on = XY) {\n  line(start = [var 0mm, var 0mm], end = [var 2mm, var 2mm])\n}\n`
        const root = await storage.seedAndOpen(
          'Background sketch saves',
          initialCode
        )
        await scene.settled()
        await openExistingSketch(toolbar, 'profile')
        await flushEditorAndThumbnailSaves(page)
        const savedBefore = await storage.read(root)
        const uploadsBefore = storage.remote.uploads.length
        const revisionBefore = storage.remote.projects.find((project) =>
          root.endsWith(project.id)
        )?.revision
        const upload = Promise.withResolvers<undefined>()
        let uploadStarted = false
        const uploadedContents: string[] = []
        const uploadRoute = '**/user/projects/*'
        if (kind === 'cloud')
          await context.route(uploadRoute, async (route) => {
            if (route.request().method() !== 'PUT') return route.fallback()
            const data = await uploadedProject(route)
            if (data.files['main.kcl'])
              uploadedContents.push(data.files['main.kcl'])
            if (!uploadStarted) {
              uploadStarted = true
              await upload.promise
            }
            await route.fallback()
          })
        const localGate =
          kind === 'local'
            ? await holdEditorWrites(
                page,
                await storage.fs.join(root, 'main.kcl')
              )
            : undefined
        try {
          await page.getByTestId('point').click()
          for (const [index, position] of [
            [0.25, 0.35],
            [0.7, 0.6],
            [0.3, 0.65],
          ].entries()) {
            const [click] = scene.makeMouseHelpers(position[0], position[1], {
              format: 'ratio',
            })
            await click()
            await expect(
              page.locator('[data-handle="sketch-point-handle"]')
            ).toHaveCount(3 + index)
            if (index === 0)
              await expect
                .poll(() =>
                  localGate
                    ? localGate.evaluate((gate) => gate.started())
                    : uploadStarted
                )
                .toBe(true)
          }
          await pauseAppClock(page)
          await page.clock.runFor(7_000)
          expect(await storage.read(root)).toBe(savedBefore)
          await expect
            .poll(() =>
              page.evaluate(
                () =>
                  window.app.singletons.kclManager.code.match(/point\(/g)
                    ?.length ?? 0
              )
            )
            .toBe(3)
          expect(
            localGate
              ? await localGate.evaluate((gate) => gate.contents().length)
              : uploadedContents.length
          ).toBe(1)
          await page.clock.resume()
          if (localGate) await localGate.evaluate((gate) => gate.release())
          else upload.resolve(undefined)
          await expect
            .poll(
              async () =>
                (await storage.read(root))?.match(/point\(/g)?.length ?? 0
            )
            .toBe(3)
          const writes = localGate
            ? await localGate.evaluate((gate) => gate.contents())
            : uploadedContents
          expect(
            writes.map((code) => code.match(/point\(/g)?.length ?? 0)
          ).toEqual([1, 3])
          if (kind === 'cloud')
            expect(storage.remote.uploads.slice(uploadsBefore)).toEqual([
              revisionBefore,
              String(Number(revisionBefore) + 1),
            ])
        } finally {
          upload.resolve(undefined)
          if (localGate) {
            await localGate.evaluate((gate) => {
              gate.release()
              gate.restore()
            })
            await localGate.dispose()
          }
          if (kind === 'cloud') await context.unroute(uploadRoute)
          await page.clock.resume()
        }
      })

      test('keeps line and rectangle source updating throughout draft movement', async ({
        page,
        context,
      }, testInfo) => {
        test.setTimeout(180_000)
        const storage = await prepareStorage(kind, page, context, testInfo, {
          modeling: true,
        })
        const scene = new SceneFixture(page)
        const toolbar = new ToolbarFixture(page)
        const root = await storage.seedAndOpen('Live sketch drafts', blankCode)
        await scene.settled()
        await toolbar.startSketchOnDefaultPlane('Top plane')
        await toolbar.lineBtn.click()
        const [start] = scene.makeMouseHelpers(0.25, 0.3, { format: 'ratio' })
        const [finish, move] = scene.makeMouseHelpers(0.4, 0.6, {
          format: 'ratio',
        })
        await start()
        await expect(
          page.locator('[data-handle="sketch-point-handle"]')
        ).toHaveCount(2)
        const initialLine = await readEditorCode(page)
        await move()
        await expect.poll(() => readEditorCode(page)).not.toBe(initialLine)
        await finish()
        await page.keyboard.press('Escape')
        await expect
          .poll(
            async () =>
              (await storage.read(root))?.match(/line\(/g)?.length ?? 0
          )
          .toBe(1)
        await toolbar.rectangleBtn.click()
        const [corner] = scene.makeMouseHelpers(0.6, 0.35, { format: 'ratio' })
        const [opposite, moveRectangle] = scene.makeMouseHelpers(0.8, 0.65, {
          format: 'ratio',
        })
        await corner()
        const [, previewRectangle] = scene.makeMouseHelpers(0.7, 0.5, {
          format: 'ratio',
        })
        await expect
          .poll(async () => {
            // Continue moving while the first-click draft finishes solving.
            await previewRectangle()
            return page.evaluate(
              () =>
                window.app.singletons.kclManager.code.match(/line\(/g)
                  ?.length ?? 0
            )
          })
          .toBe(5)
        const initialRectangle = await readEditorCode(page)
        await moveRectangle()
        await expect.poll(() => readEditorCode(page)).not.toBe(initialRectangle)
        await opposite()
        await page.keyboard.press('Escape')
        await expect
          .poll(
            async () =>
              (await storage.read(root))?.match(/line\(/g)?.length ?? 0
          )
          .toBe(5)
        await storage.assertStorage(root)
      })

      test('refreshes external geometry while an existing sketch stays open', async ({
        page,
        context,
      }, testInfo) => {
        test.setTimeout(180_000)
        const storage = await prepareStorage(kind, page, context, testInfo, {
          modeling: true,
        })
        const scene = new SceneFixture(page)
        const toolbar = new ToolbarFixture(page)
        const initialCode = `${blankCode}profile = sketch(on = XY) {\n  line(start = [var 0mm, var 0mm], end = [var 2mm, var 2mm])\n}\n`
        const root = await storage.seedAndOpen(
          'Updated open sketch',
          initialCode
        )
        await scene.settled()
        await openExistingSketch(toolbar, 'profile')
        await expect(
          page.locator('[data-handle="sketch-point-handle"]')
        ).toHaveCount(2)
        // Drain initial rendering and thumbnail work before measuring a refresh.
        await flushEditorAndThumbnailSaves(page)
        const uploadsBefore = storage.remote.uploads.length
        const updatedCode = initialCode.replace(
          '\n}',
          '\n  point(at = [var 8mm, var 9mm])\n}'
        )
        await storage.replace(root, updatedCode)
        if (kind === 'local' && process.env.TARGET === 'web') {
          // OPFS has no desktop file-watcher events. Inject only that boundary;
          // editor execution and the live sketch still run against real Wasm.
          await page.evaluate(() => {
            const editor = window.app.project?.executingEditor.peek()
            if (editor)
              for (const onChange of editor.onWatchEvent)
                onChange('change', editor.path)
          })
        }
        await expectEditor(page, updatedCode)
        await expect(
          page.locator('[data-handle="sketch-point-handle"]')
        ).toHaveCount(3)
        await expect(toolbar.exitSketchBtn).toBeEnabled()
        // No re-entering the sketch and no new insertion should be required.
        await expect.poll(() => storage.read(root)).toBe(updatedCode)
        // A read-only refresh must not generate another cloud revision by
        // uploading a thumbnail after the capture and save debounce timers.
        await pauseAppClock(page)
        await page.clock.runFor(7_000)
        await expect(
          page
            .locator('#statusbar')
            .getByRole('status')
            .filter({ hasText: 'Saving...' })
        ).not.toBeAttached()
        expect(storage.remote.uploads).toHaveLength(uploadsBefore)
        await page.clock.resume()
      })

      for (const removal of [
        'editor',
        'storage',
        'editor leaving a broken reference',
      ] as const) {
        test(`exits sketch mode when the active sketch is deleted through ${removal}`, async ({
          page,
          context,
        }, testInfo) => {
          const storage = await prepareStorage(kind, page, context, testInfo, {
            modeling: true,
          })
          const scene = new SceneFixture(page)
          const toolbar = new ToolbarFixture(page)
          const activeSketch =
            'profile = sketch(on = XY) {\n  line(start = [var 0mm, var 0mm], end = [var 2mm, var 2mm])\n}\n'
          const remainingSketch =
            'other = sketch(on = XY) {\n  point(at = [var 8mm, var 9mm])\n}\n'
          const brokenReference =
            removal === 'editor leaving a broken reference'
              ? 'result = profile\n'
              : ''
          const initialCode =
            blankCode + activeSketch + remainingSketch + brokenReference
          const updatedCode = blankCode + remainingSketch + brokenReference
          const root = await storage.seedAndOpen(
            'Deleted active sketch',
            initialCode
          )
          await scene.settled()
          await openExistingSketch(toolbar, 'profile')
          await page.evaluate(() =>
            window.app.singletons.kclManager.flushWriteToFile()
          )
          await page.getByTestId('point').click()
          if (removal === 'editor') {
            await editThroughUI(page, `${initialCode}unfinished = (`)
            await expect
              .poll(() =>
                page.evaluate(() =>
                  window.app.singletons.kclManager.hasParseErrors()
                )
              )
              .toBe(true)
            expect(
              await page.evaluate(() =>
                window.app.singletons.kclManager.modelingState?.matches(
                  'sketchSolveMode'
                )
              )
            ).toBe(true)
          }
          if (removal.startsWith('editor'))
            await editThroughUI(page, updatedCode)
          else {
            const download = Promise.withResolvers<undefined>()
            let downloading = false
            if (kind === 'cloud')
              await context.route('**/versions/*/download*', async (route) => {
                downloading = true
                await download.promise
                await route.fallback()
              })
            try {
              await storage.replace(root, updatedCode)
              if (kind === 'cloud') {
                await expect.poll(() => downloading).toBe(true)
                await installPausedClock(page)
                await page.clock.runFor(7_000)
                await expect(toolbar.exitSketchBtn).toBeEnabled()
              }
            } finally {
              download.resolve(undefined)
              if (kind === 'cloud') await page.clock.resume()
            }
            if (kind === 'local' && process.env.TARGET === 'web')
              await page.evaluate(() => {
                const editor = window.app.project?.executingEditor.peek()
                if (editor)
                  for (const onChange of editor.onWatchEvent)
                    onChange('change', editor.path)
              })
          }
          await expectEditor(page, updatedCode)
          await expect
            .poll(() =>
              page.evaluate(() =>
                window.app.singletons.kclManager.modelingState?.matches(
                  'sketchSolveMode'
                )
              )
            )
            .toBe(false)
          await expect(toolbar.exitSketchBtn).not.toBeVisible()
          await expect(
            page.locator('[data-handle="sketch-point-handle"]')
          ).toHaveCount(0)
          await expect.poll(() => storage.read(root)).toBe(updatedCode)
          if (brokenReference) {
            await editThroughUI(page, blankCode + remainingSketch)
            await expectEditor(page, blankCode + remainingSketch)
            await expect
              .poll(() =>
                page.evaluate(
                  () => window.app.singletons.kclManager.diagnostics
                )
              )
              .toEqual([])
          }
          // The surviving sketch remains editable; exiting must not delete its objects.
          await (await toolbar.getFeatureTreeOperation('other', 0)).dblclick()
          await expect(toolbar.exitSketchBtn).toBeEnabled()
          await expect(
            page.locator('[data-handle="sketch-point-handle"]')
          ).toHaveCount(1)
          await expect
            .poll(() => storage.read(root))
            .toBe(blankCode + remainingSketch)
        })
      }

      test('reads newer file contents before inserting each sketch shape', async ({
        page,
        context,
      }, testInfo) => {
        test.setTimeout(180_000)
        const storage = await prepareStorage(kind, page, context, testInfo, {
          modeling: true,
        })
        const scene = new SceneFixture(page)
        const toolbar = new ToolbarFixture(page)
        const root = await storage.seed(
          'Fresh sketch contents',
          `${blankCode}width = 1\n`
        )
        await storage.refresh()
        await storage.home.openProject('Fresh sketch contents')
        await scene.settled()
        await page.evaluate(() =>
          window.app.project?.executingEditor.peek()?.unwatch()
        )
        await storage.replace(
          root,
          `${blankCode}// before creating the sketch\nwidth = 2\n`
        )
        await toolbar.startSketchOnDefaultPlane('Top plane')
        await expect.poll(() => storage.read(root)).toContain('sketch(')
        await expect
          .poll(() => storage.read(root))
          .toContain('// before creating the sketch')
        await page.getByTestId('point').click()
        for (const [index, position] of [
          [0.25, 0.35],
          [0.65, 0.6],
        ].entries()) {
          // This case changes an acknowledged file. Concurrent external edits
          // during an active save are covered by conflict/reconciliation tests.
          await page.evaluate(() =>
            window.app.singletons.kclManager.waitForFileSaves()
          )
          const previous = await storage.read(root)
          if (!previous) throw new Error('Missing saved sketch')
          const marker = `// external edit ${index}\n`
          await page.evaluate(() =>
            window.app.project?.executingEditor.peek()?.unwatch()
          )
          await storage.replace(root, marker + previous)
          const [click] = scene.makeMouseHelpers(position[0], position[1], {
            format: 'ratio',
          })
          await click()
          await expect(
            page.locator('[data-handle="sketch-point-handle"]')
          ).toHaveCount(index + 1)
          await expect.poll(() => storage.read(root)).toContain(marker.trim())
          await expect
            .poll(
              async () =>
                (await storage.read(root))?.match(/point\(/g)?.length ?? 0
            )
            .toBe(index + 1)
        }
      })

      test('revalidates identical code in different files after deleting an import', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo, {
          modeling: true,
        })
        const code = `${blankCode}import value from "dependency.kcl"\nresult = value\n`
        await storage.seedAndOpen('Import diagnostics', blankCode, {
          'broken/one.kcl': code,
          'broken/dependency.kcl': `${blankCode}export value = 7\n`,
          'healthy/two.kcl': code,
          'healthy/dependency.kcl': `${blankCode}export value = 23\n`,
        })
        await new SceneFixture(page).settled()
        await expectEditor(page, blankCode)
        await openLayoutPanes(page, DefaultLayoutPaneID.Files)
        const item = (name: string) =>
          page.getByRole('treeitem', { name, exact: true })
        await expandFileTreeFolder(page, 'broken')
        await item('dependency.kcl').click({ button: 'right' })
        await page.getByRole('button', { name: 'Delete', exact: true }).click()
        await page.getByTestId('delete-confirmation').click()
        await expect(item('dependency.kcl')).not.toBeAttached()
        const diagnostics = () =>
          page.evaluate(() =>
            window.app.singletons.kclManager.diagnostics.map(
              (diagnostic) => diagnostic.message
            )
          )
        for (let visit = 0; visit < 2; visit++) {
          await expandFileTreeFolder(page, 'broken')
          await item('one.kcl').click()
          await expectEditor(page, code)
          await expect
            .poll(async () => (await diagnostics()).join('\n'))
            .toMatch(
              /(?:could not find file|Unable to read-file).*dependency\.kcl/i
            )
          await expect(page.locator('.cm-lint-marker-error')).not.toHaveCount(0)
          await expandFileTreeFolder(page, 'healthy')
          await item('two.kcl').click()
          await expectEditor(page, code)
          await expect.poll(diagnostics).toEqual([])
          await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
          await expect
            .poll(() =>
              page.evaluate(
                () => window.app.singletons.kclManager.lastSuccessfulCode
              )
            )
            .toBe(code)
        }
      })

      test('revalidates an imported module after deleting another import from the open entrypoint', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo, {
          modeling: true,
        })
        const code = `${blankCode}import value from "dependency.kcl"\nimport healthyValue from "healthy.kcl"\nresult = value + healthyValue\n`
        const healthyCode = `${blankCode}export healthyValue = 23\n`
        await storage.seedAndOpen('Active import diagnostics', code, {
          'dependency.kcl': `${blankCode}export value = 7\n`,
          'healthy.kcl': healthyCode,
        })
        await new SceneFixture(page).settled()
        await expectEditor(page, code)
        await expect
          .poll(() =>
            page.evaluate(
              () => window.app.singletons.kclManager.lastSuccessfulCode
            )
          )
          .toBe(code)
        await openLayoutPanes(page, DefaultLayoutPaneID.Files)
        const item = (name: string) =>
          page.getByRole('treeitem', { name, exact: true })
        await item('dependency.kcl').click({ button: 'right' })
        await page.getByRole('button', { name: 'Delete', exact: true }).click()
        await page.getByTestId('delete-confirmation').click()
        await expect(item('dependency.kcl')).not.toBeAttached()
        // Re-execute the importer after deletion before switching modules.
        await editThroughUI(page, `${code}\n`)
        await expect(page.locator('.cm-lint-marker-error')).not.toHaveCount(0)
        await item('healthy.kcl').click()
        await expectEditor(page, healthyCode)
        await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
        await expect
          .poll(() =>
            page.evaluate(
              () => window.app.singletons.kclManager.lastSuccessfulCode
            )
          )
          .toBe(healthyCode)
      })

      test('clears errors when deleting the open file and switching to a valid file', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo, {
          modeling: true,
        })
        const brokenCode = `${blankCode}import value from "missing.kcl"\nresult = value\n`
        const healthyCode = `${blankCode}result = 23\n`
        await storage.seedAndOpen('Deleted editor diagnostics', blankCode, {
          'broken.kcl': brokenCode,
          'healthy.kcl': healthyCode,
        })
        await new SceneFixture(page).settled()
        await expectEditor(page, blankCode)
        await openLayoutPanes(page, DefaultLayoutPaneID.Files)
        const item = (name: string) =>
          page.getByRole('treeitem', { name, exact: true })
        await item('broken.kcl').click()
        await expectEditor(page, brokenCode)
        await expect(page.locator('.cm-lint-marker-error')).not.toHaveCount(0)
        await item('broken.kcl').click({ button: 'right' })
        await page.getByRole('button', { name: 'Delete', exact: true }).click()
        await page.getByTestId('delete-confirmation').click()
        await expect(item('broken.kcl')).not.toBeAttached()
        await expectEditor(page, blankCode)
        await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
        await item('healthy.kcl').click()
        await expectEditor(page, healthyCode)
        await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
        await expect
          .poll(() =>
            page.evaluate(
              () => window.app.singletons.kclManager.lastSuccessfulCode
            )
          )
          .toBe(healthyCode)
      })
      test('imports single-file samples into unique folders in the same project', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo)
        const root = await storage.seedAndOpen('Sample destination', blankCode)
        await expectEditor(page, blankCode)
        await openLayoutPanes(page, DefaultLayoutPaneID.Files)
        const cmdBar = new CmdBarFixture(page)
        for (const folder of ['ball-bearing', 'ball-bearing-1']) {
          await page.getByTestId('add-file-to-project-pane-button').click()
          await cmdBar.expectCommandName('Add file to project')
          await expect(page.getByTestId('cmd-bar-arg-name')).toHaveText(
            'source'
          )
          await page.keyboard.press('Enter')
          await expect(page.getByTestId('cmd-bar-arg-name')).toHaveText(
            'sample'
          )
          await cmdBar
            .selectOption({ name: 'Ball Bearing', exact: true })
            .click()
          await expect
            .poll(() => page.evaluate(() => window.app.project?.executingPath))
            .toBe(await storage.fs.join(root, folder, 'main.kcl'))
          await expect(
            page
              .getByTestId('file-tree-item')
              .getByText(folder, { exact: true })
          ).toBeVisible()
          await expect
            .poll(() => storage.read(root, `${folder}/main.kcl`))
            .toContain('@settings')
          expect(await page.evaluate(() => window.app.project?.path)).toBe(root)
          expect(await storage.read(root)).toBe(blankCode)
        }
        await storage.refresh()
        await expect
          .poll(() => storage.read(root, 'ball-bearing/main.kcl'))
          .toContain('@settings')
        await expect
          .poll(() => storage.read(root, 'ball-bearing-1/main.kcl'))
          .toContain('@settings')
      })

      test('restores deleted files through session undo and redo', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo)
        const removedCode = `${blankCode}original = 7\n`
        const root = await storage.seedAndOpen('Deletion history', blankCode, {
          'deleted.kcl': removedCode,
        })
        await expectEditor(page, blankCode)
        await openLayoutPanes(page, DefaultLayoutPaneID.Files)
        const deletedFile = page.getByRole('treeitem', {
          name: 'deleted.kcl',
          exact: true,
        })
        await deletedFile.click({ button: 'right' })
        await page.getByRole('button', { name: 'Delete', exact: true }).click()
        await expect(
          page.getByText('You can undo this deletion.', { exact: false })
        ).toBeVisible()
        await page.getByTestId('delete-confirmation').click()
        await expect(deletedFile).not.toBeAttached()
        const undo = page.getByRole('button', {
          name: /^arrow turn left\b/,
        })
        const redo = page.getByRole('button', {
          name: /^arrow turn right\b/,
        })
        if (kind === 'cloud') {
          await expect(undo).toBeEnabled()
          let failHistoricalDownload = true
          await context.route('**/versions/*/download*', async (route) => {
            if (failHistoricalDownload) {
              failHistoricalDownload = false
              await route.fulfill({
                status: 400,
                json: { message: 'Historical download unavailable' },
              })
            } else await route.fallback()
          })
          await undo.click()
          await expect(
            page.getByText(/Historical download unavailable/)
          ).toBeVisible()
          await expect(deletedFile).not.toBeAttached()
        }
        await expect(undo).toBeEnabled()
        await undo.click()
        await expect(deletedFile).toBeVisible()
        await expect
          .poll(() => storage.read(root, 'deleted.kcl'))
          .toBe(removedCode)
        if (kind === 'cloud')
          expect(storage.remote.downloadRequests.at(-1)).toMatchObject({
            paths: ['deleted.kcl'],
            selected: true,
          })
        await expect(redo).toBeEnabled()
        await redo.click()
        await expect(deletedFile).not.toBeAttached()
        if (kind === 'cloud')
          await expect
            .poll(() => storage.read(root, 'deleted.kcl'))
            .toBeUndefined()
        else
          await expect(
            storage.fs.stat(await storage.fs.join(root, 'deleted.kcl'))
          ).rejects.toBeDefined()
        await expect(undo).toBeEnabled()
        await undo.click()
        await expect(deletedFile).toBeVisible()
        await deletedFile.dblclick()
        await expectEditor(page, removedCode)
        expect(await storage.read(root)).toBe(blankCode)
        await storage.refresh()
        await expect
          .poll(() => storage.read(root, 'deleted.kcl'))
          .toBe(removedCode)
      })

      test('undoes deletion of a folder containing the active file and an empty folder', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo)
        const code = `${blankCode}original = 7\n`
        const root = await storage.seedAndOpen(
          'Folder deletion history',
          blankCode,
          {
            'folder/active.kcl': code,
          }
        )
        await expectEditor(page, blankCode)
        await page.evaluate(
          async ({ root, pane }) => {
            const app = window.app
            const empty = window.fsZds.join(root, 'folder', 'empty')
            await app.fileOperations.createDirectory(empty)
            await app.projectSession.refreshProject()
            app.layout.openPane(pane)
            await app.projectSession.openFile(
              window.fsZds.join(root, 'folder', 'active.kcl'),
              { projectPath: root }
            )
          },
          { root, pane: DefaultLayoutPaneID.Files }
        )
        await expectEditor(page, code)
        const folder = page.getByRole('treeitem', {
          name: 'folder',
          exact: true,
        })
        await folder.click({ button: 'right' })
        await page.getByRole('button', { name: 'Delete', exact: true }).click()
        await page.getByTestId('delete-confirmation').click()
        await expect(folder).not.toBeAttached()
        await expectEditor(page, blankCode)
        const undo = page.getByRole('button', {
          name: /^arrow turn left\b/,
        })
        const redo = page.getByRole('button', {
          name: /^arrow turn right\b/,
        })
        for (const restore of [true, false, true]) {
          await (restore ? undo : redo).click()
          if (restore) {
            await expect(folder).toBeVisible()
            await expect
              .poll(() => storage.read(root, 'folder/active.kcl'))
              .toBe(code)
            expect(
              await page.evaluate(
                async (root) =>
                  window.app.fileOperations.readDirectory(
                    window.fsZds.join(root, 'folder', 'empty')
                  ),
                root
              )
            ).toEqual([])
          } else await expect(folder).not.toBeAttached()
        }
        expect(await storage.read(root)).toBe(blankCode)
        await storage.refresh()
        await expectEditor(page, blankCode)
        // Only file contents survive reload; the session's undo history does not.
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                window.app.project?.executingEditor.peek()?.globalHistoryView
                  .undoDepth
            )
          )
          .toBe(0)
        await expect
          .poll(() => storage.read(root, 'folder/active.kcl'))
          .toBe(code)
      })
      test('keeps local files editable and cloud files read-only across disconnection', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo)
        const root = await storage.seedAndOpen('Offline editing', blankCode, {
          'note.md': '# Note\n',
        })
        await expectEditor(page, blankCode)
        await openLayoutPanes(page, DefaultLayoutPaneID.Files)
        await page.waitForLoadState('networkidle')
        try {
          await context.setOffline(true)
          await page.waitForTimeout(7_000)
          const code = `${blankCode}// local edit without internet\n`
          if (kind === 'cloud') {
            await expect(
              page.getByText('Offline. Cloud project is read-only.', {
                exact: true,
              })
            ).toBeVisible()
            await expect(page.locator('.cm-content').first()).toHaveAttribute(
              'contenteditable',
              'false'
            )
            await expect(page.getByTestId('create-file-button')).toBeDisabled()
            await expect(
              page.getByTestId('create-folder-button')
            ).toBeDisabled()
            // A command must not bypass the disabled editor surface.
            await page.evaluate(() => {
              const editor = window.app.singletons.kclManager
              editor.editorView.dispatch({
                changes: { from: 0, insert: '// blocked\n' },
              })
              editor.updateCodeEditor('// blocked command\n')
            })
            await expectEditor(page, blankCode)
          } else {
            await editThroughUI(page, code)
            await expect.poll(() => storage.read(root)).toBe(code)
          }
          await page
            .getByRole('treeitem', { name: 'note.md', exact: true })
            .click()
          await expectEditor(page, '# Note\n')
          await expect(page.locator('.cm-content').first()).toHaveAttribute(
            'contenteditable',
            kind === 'cloud' ? 'false' : 'true'
          )
          if (kind === 'local') {
            await editThroughUI(page, '# Offline local edit\n')
            await expect
              .poll(() => storage.read(root, 'note.md'))
              .toBe('# Offline local edit\n')
          }
          await context.setOffline(false)
          await expect(page.locator('.cm-content').first()).toHaveAttribute(
            'contenteditable',
            'true'
          )
          await editThroughUI(page, '# Reconnected edit\n')
          await expect
            .poll(() => storage.read(root, 'note.md'))
            .toBe('# Reconnected edit\n')
          await page
            .getByRole('treeitem', { name: 'main.kcl', exact: true })
            .click()
          await expect(page.locator('.cm-content').first()).toHaveAttribute(
            'contenteditable',
            'true'
          )
          const finalCode = `${blankCode}// reconnected KCL edit\n`
          await editThroughUI(page, finalCode)
          await expect.poll(() => storage.read(root)).toBe(finalCode)
        } finally {
          await context.setOffline(false)
        }
      })

      if (kind === 'cloud') {
        test('resumes a cloud edit caught by disconnection without another keystroke', async ({
          page,
          context,
        }, testInfo) => {
          const storage = await prepareStorage(kind, page, context, testInfo)
          const root = await storage.seedAndOpen(
            'Interrupted cloud edit',
            blankCode
          )
          await expectEditor(page, blankCode)
          await page.waitForLoadState('networkidle')
          const code = `${blankCode}// typed just before disconnection\n`
          await editThroughUI(page, code)
          try {
            await context.setOffline(true)
            await page.waitForTimeout(7_000)
            await expectEditor(page, code)
            expect(await storage.read(root)).toBe(blankCode)
            await context.setOffline(false)
            await expect.poll(() => storage.read(root)).toBe(code)
            await expectEditor(page, code)
          } finally {
            await context.setOffline(false)
          }
        })
      }
      test('recovers a failed save through the editor without losing edits', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo)
        const root = await storage.seedAndOpen('Recoverable save', blankCode)
        await expectEditor(page, blankCode)
        const code = `${blankCode}// Retained after a failed save\n`
        const gate = Promise.withResolvers<undefined>()
        let started = false
        let fail = true
        if (kind === 'cloud')
          await context.route('**/user/projects/**', async (route) => {
            if (route.request().method() === 'PUT' && fail) {
              const upload = await uploadedProject(route)
              if (upload.files['main.kcl'] === code) {
                started = true
                await gate.promise
                return route.fulfill({
                  status: 503,
                  json: { message: 'Storage unavailable' },
                })
              }
            }
            await route.fallback()
          })
        // Inject at the local writer boundary; persistence after recovery is real.
        const localFailure = await page.evaluateHandle((local) => {
          const io = window.app.singletons.kclManager.textFileIO
          const write = io.write.bind(io)
          const gate = Promise.withResolvers<undefined>()
          let started = false
          if (local)
            Object.assign(io, {
              write: async () => {
                started = true
                await gate.promise
                return Promise.reject(
                  Object.assign(new Error('Disk unavailable'), {
                    code: 'ENOSPC',
                  })
                )
              },
            })
          return {
            started: () => started,
            release: () => gate.resolve(undefined),
            restore: () => {
              Object.assign(io, { write })
            },
          }
        }, kind === 'local')
        try {
          await editThroughUI(page, code)
          await expect
            .poll(() =>
              kind === 'cloud'
                ? started
                : localFailure.evaluate((f) => f.started())
            )
            .toBe(true)
          await installPausedClock(page)
          await page.clock.runFor(7_000)
          await expect(
            page.getByRole('status').filter({ hasText: 'Saving...' })
          ).toBeVisible()
          await expectEditor(page, code)
          expect(await storage.read(root)).toBe(blankCode)
          gate.resolve(undefined)
          await localFailure.evaluate((f) => f.release())
          await page.clock.resume()
          const retry = page.locator('#statusbar').getByRole('button', {
            name: 'Save failed. Retry',
          })
          await expect(retry).toBeVisible()
          await expectEditor(page, code)
          expect(await storage.read(root)).toBe(blankCode)
          fail = false
          await localFailure.evaluate((f) => f.restore())
          await retry.click()
          await expect.poll(() => storage.read(root)).toBe(code)
          await expect(retry).toBeHidden()
          await expect
            .poll(() =>
              page.evaluate(() =>
                window.app.singletons.kclManager.hasUnsavedLocalChanges()
              )
            )
            .toBe(false)
        } finally {
          gate.resolve(undefined)
          await localFailure.evaluate((f) => {
            f.release()
            f.restore()
          })
          await page.clock.resume()
        }
        await storage.refresh()
        await expectEditor(page, code)
        await storage.assertStorage(root)
      })

      test('allocates colliding large numeric project names without freezing', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo)
        const first = await createThroughHome(
          page,
          storage.home,
          'part-9007199254740992'
        )
        await storage.goHome()
        const second = await createThroughHome(
          page,
          storage.home,
          'part-9007199254740992'
        )
        expect(second).not.toBe(first)
        if (kind === 'local') expect(second).toContain('9007199254740993')
        await storage.goHome()
        await storage.refresh()
        await expect(storage.home.projectCard).toHaveCount(2)
        await storage.assertStorage(first)
        await storage.assertStorage(second)
      })

      test('renames and deletes nested files without changing unrelated contents', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo)
        const nestedCode = `${blankCode}// Nested file\n`
        const root = await storage.seedAndOpen('Nested operations', blankCode, {
          'parts/source.kcl': nestedCode,
          'parts/existing.kcl': `${blankCode}// Keep existing\n`,
          'unrelated/keep.kcl': `${blankCode}// Keep unrelated\n`,
        })
        await expectEditor(page, blankCode)
        await openLayoutPanes(page, DefaultLayoutPaneID.Files)
        const item = (name: string) =>
          page.getByRole('treeitem', { name, exact: true })
        await expandFileTreeFolder(page, 'parts')
        await item('source.kcl').click()
        await expectEditor(page, nestedCode)
        const rename = async (name: string, from = 'source.kcl') => {
          await item(from).click({ button: 'right' })
          await page.getByTestId('context-menu-rename').click()
          await page.getByTestId('file-rename-field').fill(name)
          await page.keyboard.press('Enter')
          await expect(page.getByTestId('file-rename-field')).not.toBeAttached()
        }
        await rename('existing.kcl')
        await expect(item('source.kcl')).toBeVisible()
        await expectEditor(page, nestedCode)
        expect(await storage.read(root, 'parts/existing.kcl')).toBe(
          `${blankCode}// Keep existing\n`
        )
        await rename('Source.kcl')
        await expect(item('Source.kcl')).toBeVisible()
        await expect(page).toHaveURL(/Source\.kcl$/)
        await expectEditor(page, nestedCode)
        await rename('cafe\u0301.kcl'.normalize('NFC'), 'Source.kcl')
        await expect(item('cafe\u0301.kcl'.normalize('NFC'))).toBeVisible()
        await rename('cafe\u0301.kcl', 'cafe\u0301.kcl'.normalize('NFC'))
        await expect(item('cafe\u0301.kcl')).toBeVisible()
        await expectEditor(page, nestedCode)
        await rename('renamed.kcl', 'cafe\u0301.kcl')
        await expect(item('renamed.kcl')).toBeVisible()
        await expect(item('source.kcl')).toBeHidden()
        await expect(page).toHaveURL(/renamed\.kcl$/)
        await expectEditor(page, nestedCode)
        await expect
          .poll(() => storage.read(root, 'parts/renamed.kcl'))
          .toBe(nestedCode)
        await storage.refresh()
        await expectEditor(page, nestedCode)
        await item('renamed.kcl').click({ button: 'right' })
        await page.getByRole('button', { name: 'Delete', exact: true }).click()
        await page.getByTestId('delete-confirmation').click()
        await expect(page).toHaveURL(/main\.kcl$/)
        await expectEditor(page, blankCode)
        await expect(item('renamed.kcl')).toBeHidden()
        await expect
          .poll(() => storage.read(root, 'unrelated/keep.kcl'))
          .toBe(`${blankCode}// Keep unrelated\n`)
        await storage.refresh()
        await expectEditor(page, blankCode)
        await expect(item('renamed.kcl')).toBeHidden()
        await storage.assertStorage(root)
      })

      test('creates a nested file, renames its folder and deletes it while keeping the project root', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo)
        const root = await storage.seedAndOpen('Nested creation', blankCode, {
          'parts/existing.kcl': blankCode,
        })
        await expectEditor(page, blankCode)
        await openLayoutPanes(page, DefaultLayoutPaneID.Files)
        const item = (name: string) =>
          page.getByRole('treeitem', { name, exact: true })
        await item('parts').click()
        await page.getByTestId('create-file-button').click()
        await page.getByTestId('file-rename-field').fill('created')
        await page.keyboard.press('Enter')
        await expect(page).toHaveURL(/parts%2Fcreated\.kcl$/)
        await expect(item('created.kcl')).toBeVisible()
        await expect
          .poll(() => storage.read(root, 'parts/created.kcl'))
          .toMatch(/^@settings\(/)
        expect(await page.evaluate(() => window.app.project?.path)).toBe(root)
        expect(await storage.read(root)).toBe(blankCode)
        await item('parts').click({ button: 'right' })
        await page.getByTestId('context-menu-rename').click()
        await page.getByTestId('file-rename-field').fill('components')
        await page.keyboard.press('Enter')
        await expect(page).toHaveURL(/components%2Fcreated\.kcl$/)
        await expect(item('parts')).toBeHidden()
        await expect(item('components')).toBeVisible()
        expect(await page.evaluate(() => window.app.project?.path)).toBe(root)
        await expect
          .poll(() => storage.read(root, 'components/existing.kcl'))
          .toBe(blankCode)
        await storage.refresh()
        await expect(item('components')).toBeVisible()
        await item('components').click({ button: 'right' })
        await page.getByRole('button', { name: 'Delete', exact: true }).click()
        await page.getByTestId('delete-confirmation').click()
        await expect(page).toHaveURL(/main\.kcl$/)
        await expectEditor(page, blankCode)
        await expect(item('components')).toBeHidden()
        await storage.refresh()
        await expectEditor(page, blankCode)
        await expect(item('components')).toBeHidden()
        expect(await storage.read(root)).toBe(blankCode)
        await storage.assertStorage(root)
      })

      test('shows project action progress and closes dialogs while storage takes seven seconds', async ({
        page,
        context,
      }, testInfo) => {
        test.skip(
          kind === 'local' && process.env.TARGET !== 'web',
          'This storage delay uses OPFS Web Locks; native-storage progress is covered at the shared action boundary.'
        )
        const storage = await prepareStorage(kind, page, context, testInfo)
        const root = await storage.seed('Slow project', blankCode)
        await storage.seed('Other project', blankCode)
        await storage.refresh()
        const projectCard = storage.home.projectCard.filter({
          hasText: 'Slow project',
        })
        await expect(projectCard).toBeVisible()
        await page.clock.install()
        for (const action of ['rename', 'delete'] as const) {
          const gate = Promise.withResolvers<undefined>()
          let started = false
          const routePattern = /\/user\/projects\/[^/?]+(?:\?.*)?$/
          const local =
            kind === 'local'
              ? await page.evaluateHandle(
                  async ({ root, action }) => {
                    const gate = Promise.withResolvers<undefined>()
                    const acquired = Promise.withResolvers<undefined>()
                    const lockName = `zds-opfs-write:${window.fsZds.join(root, 'project.toml')}`
                    // Hold the browser storage lock used by real OPFS reads/writes.
                    const lock =
                      action === 'rename'
                        ? navigator.locks.request(lockName, async () => {
                            acquired.resolve(undefined)
                            await gate.promise
                          })
                        : Promise.resolve()
                    if (action === 'rename') await acquired.promise
                    const prototype = FileSystemDirectoryHandle.prototype
                    const removeEntry = prototype.removeEntry
                    let started = false
                    if (action === 'delete')
                      prototype.removeEntry = async function (name, options) {
                        if (
                          name === window.fsZds.basename(root) &&
                          this.name ===
                            window.fsZds.basename(window.fsZds.dirname(root))
                        ) {
                          started = true
                          await gate.promise
                        }
                        return removeEntry.call(this, name, options)
                      }
                    return {
                      started: async () =>
                        action === 'rename'
                          ? (await navigator.locks.query()).pending?.some(
                              (entry) => entry.name === lockName
                            )
                          : started,
                      release: () => {
                        gate.resolve(undefined)
                        return lock
                      },
                      restore: () => {
                        prototype.removeEntry = removeEntry
                      },
                    }
                  },
                  { root, action }
                )
              : undefined
          if (kind === 'cloud')
            await context.route(routePattern, async (route) => {
              if (
                route.request().method() ===
                (action === 'rename' ? 'PUT' : 'DELETE')
              ) {
                started = true
                await gate.promise
              }
              await route.fallback()
            })
          const card = storage.home.projectCard.filter({
            hasText:
              action === 'rename' ? 'Slow project' : 'Renamed slow project',
          })
          try {
            await card.click({ button: 'right' })
            await page.getByTestId(`project-card-context-${action}`).click()
            if (action === 'rename') {
              await page
                .getByTestId('project-rename-input')
                .fill('Renamed slow project')
              await page.keyboard.press('Enter')
              await expect(
                page.getByTestId('project-rename-input')
              ).not.toBeAttached()
            } else {
              await page.getByTestId('delete-confirmation').click()
            }
            await expect(page.getByRole('dialog')).not.toBeVisible()
            await expect
              .poll(() =>
                local ? local.evaluate((gate) => gate.started()) : started
              )
              .toBe(true)
            const busy = page.getByRole('status', {
              name: `${action === 'rename' ? 'Renaming' : 'Deleting'} project Renamed slow project`,
            })
            await expect(busy).toBeVisible()
            await pauseAppClock(page)
            await page.clock.runFor(7_000)
            await expect(busy).toBeVisible()
            await expect(
              storage.home.projectCard.filter({ hasText: 'Other project' })
            ).toBeVisible()
            await expect(page).not.toHaveURL(/\/file\//)
            await page.clock.resume()
            gate.resolve(undefined)
            await local?.evaluate((gate) => gate.release())
            await expect(busy).not.toBeAttached()
            if (action === 'delete')
              await expect(
                storage.home.projectCard.filter({
                  hasText: 'Renamed slow project',
                })
              ).not.toBeAttached()
          } finally {
            gate.resolve(undefined)
            if (local) {
              await local.evaluate((gate) => {
                gate.release()
                gate.restore()
              })
              await local.dispose()
            }
            if (kind === 'cloud') await context.unroute(routePattern)
            await page.clock.resume()
          }
        }
      })

      test('renames and deletes a project from Home while preserving the other project', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo)
        await storage.seed('Rename me', blankCode)
        const otherCode = `${blankCode}// Other project\n`
        const other = await storage.seed('Keep me', otherCode)
        await storage.refresh()
        const card = (title: string) =>
          storage.home.projectCard.filter({ hasText: title })
        const originalHref = await card('Rename me').getAttribute('href')
        if (!originalHref) throw new Error('Missing project link')
        await card('Rename me').click({ button: 'right' })
        await page.getByTestId('project-card-context-rename').click()
        await page.getByTestId('project-rename-input').fill('Renamed project')
        await page.keyboard.press('Enter')
        await expect(card('Renamed project')).toBeVisible()
        await expect(card('Rename me')).toBeHidden()
        await expect(page.getByTestId('project-rename-input')).toBeHidden()
        await expect(card('Renamed project')).toHaveAttribute(
          'href',
          originalHref
        )
        await storage.home.openProject('Renamed project')
        await expectEditor(page, blankCode)
        await storage.refresh()
        await expectEditor(page, blankCode)
        await storage.goHome()
        await card('Renamed project').click({ button: 'right' })
        await page.getByTestId('project-card-context-delete').click()
        await page
          .getByRole('dialog', { name: 'Delete Project', exact: true })
          .getByRole('button', { name: 'Delete', exact: true })
          .click()
        await expect(card('Renamed project')).toBeHidden()
        await expect(card('Keep me')).toBeVisible()
        await storage.refresh()
        await expect(card('Renamed project')).toBeHidden()
        expect(await storage.read(other)).toBe(otherCode)
        await storage.home.openProject('Keep me')
        await expectEditor(page, otherCode)
        await storage.assertStorage(other)
      })

      if (kind === 'cloud') {
        test('replaces a non-KCL editor with the cloud contents after a conflict', async ({
          page,
          context,
        }, testInfo) => {
          const storage = await prepareStorage(kind, page, context, testInfo)
          const root = await storage.seedAndOpen('Text conflict', blankCode, {
            'note.md': '# Original note\n',
          })
          await expectEditor(page, blankCode)
          await openLayoutPanes(page, DefaultLayoutPaneID.Files)
          await page
            .getByRole('treeitem', { name: 'note.md', exact: true })
            .click()
          await expectEditor(page, '# Original note\n')
          const remote = storage.remote.projects[0]
          let conflict = true
          let beforeConflict: string[] = []
          let submittedRevision = ''
          await context.route('**/user/projects/**', async (route) => {
            if (route.request().method() === 'PUT' && conflict) {
              const upload = await uploadedProject(route)
              if (upload.files['note.md'] === '# Stale local note\n') {
                conflict = false
                beforeConflict = [...storage.remote.uploads]
                submittedRevision = remote.revision
                remote.files['note.md'] = '# Cloud truth\n'
                remote.revision = String(Number(remote.revision) + 1)
              }
            }
            await route.fallback()
          })
          await editThroughUI(page, '# Stale local note\n')
          await expectEditor(page, '# Cloud truth\n')
          await expect
            .poll(() => storage.read(root, 'note.md'))
            .toBe('# Cloud truth\n')
          expect(storage.remote.uploads).toEqual([
            ...beforeConflict,
            submittedRevision,
          ])
          await installPausedClock(page)
          await page.clock.runFor(7_000)
          expect(storage.remote.uploads).toEqual([
            ...beforeConflict,
            submittedRevision,
          ])
          await page.clock.resume()
          const cloudRevision = remote.revision
          await editThroughUI(page, '# Fresh note\n')
          await expect
            .poll(() => storage.read(root, 'note.md'))
            .toBe('# Fresh note\n')
          expect(storage.remote.uploads).toEqual([
            ...beforeConflict,
            submittedRevision,
            cloudRevision,
          ])
          await storage.refresh()
          await expectEditor(page, blankCode)
          await page
            .getByRole('treeitem', { name: 'note.md', exact: true })
            .click()
          await expectEditor(page, '# Fresh note\n')
        })
        for (const outcome of ['same', 'different'] as const) {
          test(`recovers a lost save acknowledgement using the cloud snapshot (${outcome} contents)`, async ({
            page,
            context,
          }, testInfo) => {
            const storage = await prepareStorage(kind, page, context, testInfo)
            const root = await storage.seedAndOpen(
              'Conflict recovery',
              blankCode
            )
            await expectEditor(page, blankCode)
            const code = `${blankCode}// Uploaded before connection loss\n`
            let loseAcknowledgement = true
            let beforeLoss: string[] = []
            let submittedRevision = ''
            await context.route('**/user/projects/**', async (route) => {
              if (route.request().method() === 'PUT' && loseAcknowledgement) {
                const upload = await uploadedProject(route)
                if (upload.files['main.kcl'] === code) {
                  loseAcknowledgement = false
                  const remote = storage.remote.projects[0]
                  submittedRevision = (await uploadedProject(route)).metadata
                    .expected_revision!
                  expect(submittedRevision).toBe(remote.revision)
                  beforeLoss = [...storage.remote.uploads]
                  remote.files = upload.files
                  remote.title = upload.title
                  remote.revision = String(Number(remote.revision) + 1)
                  return route.abort('connectionreset')
                }
              }
              await route.fallback()
            })
            await editThroughUI(page, code)
            const retry = page.getByRole('button', {
              name: 'Save failed. Retry',
            })
            await expect(retry).toBeVisible()
            const authoritative =
              outcome === 'same'
                ? code
                : `${blankCode}// Changed by another client\n`
            if (outcome === 'different')
              await storage.replace(root, authoritative)
            await retry.click()
            await expect(retry).toBeHidden()
            await expectEditor(page, authoritative)

            await expect
              .poll(() =>
                page.evaluate(() =>
                  window.app.singletons.kclManager.hasUnsavedLocalChanges()
                )
              )
              .toBe(false)
            expect(storage.remote.uploads).toEqual([
              ...beforeLoss,
              submittedRevision,
            ])
            await installPausedClock(page)
            await page.clock.runFor(7_000)
            expect(storage.remote.uploads).toEqual([
              ...beforeLoss,
              submittedRevision,
            ])
            await page.clock.resume()
            const cloudRevision = storage.remote.projects[0].revision
            const next = `${authoritative}// Fresh edit after recovery\n`
            await editThroughUI(page, next)
            await expect.poll(() => storage.read(root)).toBe(next)
            expect(storage.remote.uploads).toEqual([
              ...beforeLoss,
              submittedRevision,
              cloudRevision,
            ])
            await storage.refresh()
            await expectEditor(page, next)
          })
        }
      }

      test('creates a blank project, edits, saves, reloads and reopens it', async ({
        page,
        context,
      }, testInfo) => {
        const creation = Promise.withResolvers<undefined>()
        const storage = await prepareStorage(kind, page, context, testInfo, {
          creationGate: creation.promise,
        })
        await expect(storage.home.projectCard).toHaveCount(0)
        const homeURL = page.url()
        const title = 'Blank project'
        await storage.home.projectButtonNew.click()
        await storage.home.projectTextName.fill(title)
        await storage.home.projectButtonContinue.click()
        if (kind === 'cloud') {
          await installPausedClock(page)
          try {
            await expect.poll(() => storage.remote.creates.length).toBe(1)
            await page.clock.runFor(7_000)
            await expect(page).toHaveURL(homeURL)
            expect(storage.remote.creates).toHaveLength(1)
            expect(storage.remote.uploads).toHaveLength(0)
          } finally {
            creation.resolve(undefined)
            await page.clock.resume()
          }
        }
        await expect(page).toHaveURL(/\/file\/.*main\.kcl$/)
        await expect(
          page.getByRole('button', { name: `${title} / main.kcl caret down` })
        ).toBeVisible()
        const root = await page.evaluate(() => window.app.project!.path)
        await expect
          .poll(() => storage.read(root))
          .toMatch(/^@settings\([^)]*\)\s*$/)
        await expectEditor(page, (await storage.read(root))!)
        await expect(
          page.evaluate(
            (root) => window.app.fileOperations.readDirectory(root),
            root
          )
        ).resolves.toEqual(expect.arrayContaining(['main.kcl', 'project.toml']))
        if (kind === 'cloud') {
          expect(storage.remote.creates[0].title).toBe(title)
          expect(Object.keys(storage.remote.creates[0].files).sort()).toEqual([
            'main.kcl',
            'project.toml',
          ])
        }
        const code = `${blankCode}// Saved from a new project\nwidth = 42\n`
        await editThroughUI(page, code)
        await expect.poll(() => storage.read(root)).toBe(code)
        await expect
          .poll(() => page.evaluate(() => window.app.fileOperations.pending()))
          .toBe(0)
        if (kind === 'cloud') expect(storage.remote.uploads).toContain('1')
        await storage.refresh()
        await expectEditor(page, code)
        await storage.goHome()
        await expect(
          storage.home.projectCard.filter({ hasText: title })
        ).toHaveCount(1)
        await storage.home.openProject(title)
        await expectEditor(page, code)
        expect(storage.remote.creates).toHaveLength(kind === 'cloud' ? 1 : 0)
        await storage.assertStorage(root)
      })

      test('keeps repeated and differently cased project titles distinct without overwriting earlier projects', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo)
        // Cloud identity is the project ID; the API accepts duplicate display titles.
        // Local identity uses a case-insensitive unique directory and title suffix.
        const requested = ['Test', 'Test', 'test']
        const expected =
          kind === 'local' ? ['Test', 'Test-1', 'test-2'] : requested
        const roots: string[] = []
        for (let index = 0; index < requested.length; index++) {
          const root = await createThroughHome(
            page,
            storage.home,
            requested[index]
          )
          roots.push(root)
          await expect(
            page.getByRole('button', {
              name: `${expected[index]} / main.kcl caret down`,
            })
          ).toBeVisible()
          const code = `${blankCode}// Project ${index}\n`
          await editThroughUI(page, code)
          await expect.poll(() => storage.read(root)).toBe(code)
          await storage.goHome()
          await expect(storage.home.projectCard).toHaveCount(index + 1)
        }
        expect(new Set(roots).size).toBe(3)
        await expect
          .poll(async () =>
            (await storage.home.projectCardTitle.allTextContents()).sort()
          )
          .toEqual([...expected].sort())
        for (let index = 0; index < roots.length; index++) {
          expect(await storage.read(roots[index])).toBe(
            `${blankCode}// Project ${index}\n`
          )
          await storage.assertStorage(roots[index])
        }
      })

      test('creates twelve projects using the default title and keeps every project accessible', async ({
        page,
        context,
      }, testInfo) => {
        test.setTimeout(180_000)
        const storage = await prepareStorage(kind, page, context, testInfo)
        const roots = new Set<string>()
        for (let index = 0; index < 12; index++) {
          roots.add(await createThroughHome(page, storage.home))
          await storage.goHome()
          await expect(storage.home.projectCard).toHaveCount(index + 1)
        }
        const titles = Array.from({ length: 12 }, (_, index) =>
          kind === 'local' && index > 0 ? `untitled-${index}` : 'untitled'
        )
        await expect
          .poll(async () =>
            (await storage.home.projectCardTitle.allTextContents()).sort()
          )
          .toEqual(titles.sort())
        expect(roots.size).toBe(12)
        for (const root of roots) await storage.assertStorage(root)
      })

      for (const next of ['broken', 'empty'] as const) {
        test(`opens and renders a project, loads external changes through direct URLs and reload, then clears the scene when switching projects (${next})`, async ({
          page,
          context,
        }, testInfo) => {
          test.setTimeout(180_000)
          const storage = await prepareStorage(kind, page, context, testInfo, {
            modeling: true,
          })
          const scene = new SceneFixture(page)
          const firstRoot = await storage.seed('Rendered project', solidCode)
          const nextCode =
            next === 'broken'
              ? `${blankCode}body = extrude(missingProfile, length = 10)\n`
              : blankCode
          await storage.seed('Next project', nextCode)
          await storage.refresh()
          const download = Promise.withResolvers<undefined>()
          let downloadStarted = false
          if (kind === 'cloud') {
            await context.route(
              '**/user/projects/**/download?format=zip',
              async (route) => {
                downloadStarted = true
                await download.promise
                await route.fallback()
              }
            )
          }
          try {
            await expect.poll(() => storage.read(firstRoot)).toBe(solidCode)
            await storage.home.openProject('Rendered project')
            if (kind === 'cloud') {
              await expect.poll(() => downloadStarted).toBe(true)
              await installPausedClock(page)
              await page.clock.runFor(7_000)
              expect(storage.remote.uploads).toHaveLength(0)
              expect(await readEditorCode(page)).not.toContain(
                'body = extrude(section'
              )
            }
          } finally {
            download.resolve(undefined)
            if (kind === 'cloud') {
              await page.clock.resume()
              await context.unroute('**/user/projects/**/download?format=zip')
            }
          }
          await scene.settled()
          await expectEditor(page, solidCode)
          await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
          await storage.replace(
            firstRoot,
            `${solidCode}// Direct project load\n`
          )
          const main = await storage.fs.join(firstRoot, 'main.kcl')
          await storage.navigate(`/file/${encodeURIComponent(main)}`)
          await expectEditor(page, `${solidCode}// Direct project load\n`)
          await expect
            .poll(() =>
              page.evaluate(() => window.app.fileOperations.pending())
            )
            .toBe(0)
          const uploads = storage.remote.uploads.length
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
          expect(storage.remote.uploads).toHaveLength(uploads)
          await storage.replace(
            firstRoot,
            `${solidCode}// Changed externally\n`
          )
          await storage.refresh()
          await expectEditor(page, `${solidCode}// Changed externally\n`)
          await scene.settled()
          expect(
            await doAndWaitForImageDiff(
              scene.streamWrapper,
              async () => {
                await storage.goHome()
                await storage.home.openProject('Next project')
                await scene.settled({ expectError: next === 'broken' })
                await expectEditor(page, nextCode)
                if (next === 'broken') {
                  const diagnostic = page
                    .locator('.cm-lint-marker-error')
                    .first()
                  await expect(diagnostic).toBeVisible()
                  await diagnostic.hover()
                  await expect(
                    page.locator('.cm-tooltip-lint .cm-diagnosticText').first()
                  ).toContainText('missingProfile')
                } else {
                  await expect(
                    page.locator('.cm-lint-marker-error')
                  ).toHaveCount(0)
                }
              },
              500
            )
          ).toBe(true)
          await storage.assertStorage(firstRoot)
        })
      }

      test('switches files while reads, saves and modeling are pending and preserves the outgoing edit', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo)
        const root = await storage.seed(
          'Switching project',
          `${blankCode}// Original buffer\n`,
          { 'other.kcl': `${blankCode}// Target buffer\n` }
        )
        await storage.refresh()
        await expect
          .poll(() => storage.read(root))
          .toBe(`${blankCode}// Original buffer\n`)
        await storage.home.openProject('Switching project')
        await expectEditor(page, `${blankCode}// Original buffer\n`)
        await openLayoutPanes(
          page,
          ...[DefaultLayoutPaneID.Code, DefaultLayoutPaneID.Files]
        )
        const originalProject = await page.evaluateHandle(
          () => window.app.project
        )
        const save = Promise.withResolvers<undefined>()
        let cloudSaveStarted = false
        if (kind === 'cloud') {
          await context.route('**/user/projects/**', async (route) => {
            if (route.request().method() === 'PUT' && !cloudSaveStarted) {
              cloudSaveStarted = true
              await save.promise
            }
            await route.fallback()
          })
        }
        const buffer = await holdFileRead(page, 'other.kcl')
        const modeling = await holdModelingOpen(page)
        const localSave =
          kind === 'local'
            ? await holdEditorWrites(
                page,
                await storage.fs.join(root, 'main.kcl')
              )
            : undefined
        const code = `${blankCode}// Outgoing edit\n`
        try {
          await editThroughUI(page, code)
          await page
            .getByRole('treeitem', { name: 'other.kcl', exact: true })
            .click()
          await expect(
            page.getByRole('status', { name: 'Loading file' })
          ).toBeVisible()
          await expect(
            page.locator('#code-mirror-override').locator('..')
          ).toHaveAttribute('inert', '')
          await installPausedClock(page)
          await page.clock.runFor(7_000)
          await expect
            .poll(() =>
              kind === 'cloud'
                ? cloudSaveStarted
                : localSave!.evaluate((gate) => gate.started())
            )
            .toBe(true)
          await page.clock.runFor(7_000)
          await expect(
            page.getByRole('status', { name: 'Loading file' })
          ).toBeVisible()
          await buffer.evaluate((release) => release())
          await page.clock.resume()
          await expectEditor(page, `${blankCode}// Target buffer\n`)
          await expect(
            page.getByRole('status', { name: 'Loading file' })
          ).toBeHidden()
          expect(
            await originalProject.evaluate(
              (project) => window.app.project === project
            )
          ).toBe(true)
          await editThroughUI(page, `${blankCode}// Target buffer edited\n`)
          await page
            .getByRole('treeitem', { name: 'main.kcl', exact: true })
            .click()
          await expectEditor(page, code)
        } finally {
          save.resolve(undefined)
          // Restore all browser boundaries in one turn, before released work runs.
          expect(
            await page.evaluate(
              ({ buffer, modeling, save }) => {
                buffer()
                save?.release()
                save?.restore()
                return modeling()
              },
              { buffer, modeling, save: localSave }
            )
          ).toBe(0)
          await page.clock.resume()
        }
        await expect.poll(() => storage.read(root)).toBe(code)
        await expect
          .poll(() => storage.read(root, 'other.kcl'))
          .toBe(`${blankCode}// Target buffer edited\n`)
        await storage.assertStorage(root)
      })
    }
  )
}
