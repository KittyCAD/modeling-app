import type { ConsoleMessage, Page } from '@playwright/test'
import { expect, test as zooTest } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

const panicMarker = 'E2E fault injection: intentional Rust/Wasm panic'
interface WasmEvidence {
  pageErrors: Error[]
  panicMessages: string[]
}

const test = zooTest.extend<{ wasmEvidence: WasmEvidence }>({
  wasmEvidence: [
    async ({ context }, use, testInfo) => {
      const evidence: WasmEvidence = { pageErrors: [], panicMessages: [] }
      const pages = new Set<Page>()
      const onPageError = (error: Error) => evidence.pageErrors.push(error)
      const onConsole = (message: ConsoleMessage) => {
        if (message.text().includes(panicMarker))
          evidence.panicMessages.push(message.text())
      }
      const observePage = (page: Page) => {
        if (pages.has(page)) return
        pages.add(page)
        page.on('pageerror', onPageError)
        page.on('console', onConsole)
      }
      // Observe native errors before the page fixture navigates/initializes.
      context.on('page', observePage)
      context.pages().forEach(observePage)
      try {
        await use(evidence)
      } finally {
        context.off('page', observePage)
        for (const page of pages) {
          page.off('pageerror', onPageError)
          page.off('console', onConsole)
        }
        await testInfo.attach('wasm-runtime-evidence', {
          body: JSON.stringify({
            errors: evidence.pageErrors.map(({ name, message, stack }) => ({
              name,
              message,
              stack,
            })),
            panicMessages: evidence.panicMessages,
          }),
          contentType: 'application/json',
        })
      }
    },
    { auto: true },
  ],
})
test.use({ mockApiRoutes: false })

const dimensionsCode = `@settings(defaultLengthUnit = mm, kclVersion = 3.0)
export height = 5mm
`
const modelCode = `@settings(defaultLengthUnit = mm, kclVersion = 3.0)
import height from "dimensions.kcl"
radiusValue = 10mm
profile = sketch(on = XY) {
  perimeter = circle(start = [var 10mm, var 0mm], center = [var 0mm, var 0mm])
  coincident([perimeter.center, ORIGIN])
  radius(perimeter) == radiusValue
  horizontal([perimeter.center, perimeter.start])
}
body = extrude(region(segments = [profile.perimeter]), length = height)
`

async function waitForExecutedModel(page: Page, code: string) {
  await expect
    .poll(
      () =>
        page.evaluate((code) => {
          const editor = window.app.project?.executingEditor.value
          return Boolean(
            editor &&
              editor.code.trim() === code.trim() &&
              editor.lastSuccessfulCode.trim() === code.trim() &&
              !editor.hasErrors() &&
              !editor.isExecutingSignal.value &&
              editor.artifactGraph.size > 0 &&
              editor.engineCommandManager.isReady &&
              Object.keys(editor.engineCommandManager.pendingCommands)
                .length === 0
          )
        }, code),
      { timeout: 30_000 }
    )
    .toBe(true)
}

async function presentedForeground(page: Page) {
  return page.locator('#video-stream').evaluate(async (video) => {
    if (
      !(video instanceof HTMLVideoElement) ||
      video.paused ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    )
      throw new Error('The real engine video is not playing')
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Unable to read the actual engine frame')
    context.drawImage(video, 0, 0)
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    const background = (canvas.width + 1) * 4
    let foreground = 0
    for (let y = Math.floor(canvas.height / 5); y < canvas.height * 0.8; y++)
      for (let x = Math.floor(canvas.width / 5); x < canvas.width * 0.8; x++) {
        const index = (y * canvas.width + x) * 4
        if (
          Math.abs(data[index] - data[background]) +
            Math.abs(data[index + 1] - data[background + 1]) +
            Math.abs(data[index + 2] - data[background + 2]) >=
          80
        )
          foreground++
      }
    return foreground
  })
}

test(
  'normal builds do not expose the Wasm panic hook',
  { tag: ['@desktop', '@web'] },
  async ({ page, wasmEvidence }, testInfo) => {
    test.skip(testInfo.project.metadata.wasmFaultInjection === true)
    await page.waitForFunction(() => window.app?.wasmPromise !== undefined)
    expect(
      await page.evaluate(async () =>
        Reflect.has(await window.app.wasmPromise, 'e2e_panic')
      )
    ).toBe(false)
    expect(wasmEvidence.pageErrors).toEqual([])
  }
)

test.describe('fault-build-only recovery', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.metadata.wasmFaultInjection !== true)
  })
  test('recovers from a genuine Rust/Wasm panic with the current unsaved project', async ({
    page,
    fs,
    folderSetupFn,
    homePage,
    toolbar,
    editor,
    scene,
    wasmEvidence,
  }, testInfo) => {
    const { pageErrors, panicMessages } = wasmEvidence
    await folderSetupFn(async (directory) => {
      const project = await fs.join(directory, 'wasm-recovery')
      await fs.mkdir(project, { recursive: true })
      await fs.writeFile(
        await fs.join(project, 'main.kcl'),
        new TextEncoder().encode(modelCode)
      )
      await fs.writeFile(
        await fs.join(project, 'dimensions.kcl'),
        new TextEncoder().encode(dimensionsCode)
      )
    })
    await homePage.waitForAuthentication()
    await homePage.projectsLoaded()
    await homePage.openProject('wasm-recovery')
    await scene.settled()
    await waitForExecutedModel(page, modelCode)
    await toolbar.openPane(DefaultLayoutPaneID.Code)
    await scene.moveCameraTo({ x: 45, y: -60, z: 45 }, { x: 0, y: 0, z: 2.5 })
    await expect.poll(() => presentedForeground(page)).toBeGreaterThan(1000)
    const originalForeground = await presentedForeground(page)
    const original = await page.evaluateHandle(async () => {
      const editor = window.app.project?.executingEditor.value
      if (!editor) throw new Error('No active editor')
      const module = await editor.rustContext.wasmInstancePromise
      const context: unknown = Reflect.get(editor.rustContext, 'ctxInstance')
      if (!(context instanceof module.Context))
        throw new Error('No initialized real native Context')
      return {
        editor,
        context,
        wrapper: editor.rustContext,
        path: editor.path,
      }
    })
    try {
      const unsavedCode = `${modelCode}\n// unsaved source survives a real Wasm panic\n`
      await original.evaluate(async ({ editor, wrapper }, unsavedCode) => {
        function isPanicHook(value: unknown): value is () => void {
          return typeof value === 'function'
        }
        // Use the production AST-edit buffer update contract without a disk
        // write. Do not race the normal one-second autosave grace period.
        editor.updateCodeEditor(unsavedCode, {
          shouldWriteToDisk: false,
          shouldExecute: false,
          shouldSyncRust: true,
        })
        const file: unknown = await wrapper.getFileState(editor.id)
        if (
          typeof file !== 'object' ||
          file === null ||
          !('text' in file) ||
          file.text !== unsavedCode
        )
          throw new Error('The real Rust project has not received the edit')
        const disk = await window.fsZds.readFile(editor.path, 'utf8')
        if (disk === unsavedCode)
          throw new Error('The pre-crash edit was already saved, not unsaved')
        const module = await wrapper.wasmInstancePromise
        const panic: unknown = Reflect.get(module, 'e2e_panic')
        if (!isPanicHook(panic))
          throw new Error(
            'Build the isolated e2e-fault-injection package first'
          )
        // A real uncaught Rust panic in a native browser task reaches the
        // production window error handler. No synthetic ErrorEvent/JS throw.
        requestAnimationFrame(() => panic())
      }, unsavedCode)
      await expect.poll(() => pageErrors.length).toBe(1)
      await expect.poll(() => panicMessages.length).toBeGreaterThan(0)
      await expect
        .poll(
          () =>
            original.evaluate(async ({ editor, wrapper, context }) => {
              const module = await wrapper.wasmInstancePromise
              const current: unknown = Reflect.get(wrapper, 'ctxInstance')
              return (
                window.app.project?.executingEditor.value === editor &&
                editor.rustContext === wrapper &&
                current instanceof module.Context &&
                current !== context &&
                wrapper.hasOpenedProject
              )
            }),
          { timeout: 30_000 }
        )
        .toBe(true)
      // CodeMirror's empty-line BRs add newlines to DOM innerText. Compare the
      // real document bytes, not that presentation serialization.
      expect(await original.evaluate(({ editor }) => editor.code)).toBe(
        unsavedCode
      )
      await expect(editor.codeContent).toContainText(
        '// unsaved source survives a real Wasm panic'
      )
      const restored = await original.evaluate(
        async ({ editor, wrapper, path }) => ({
          samePath: editor.path === path,
          file: await wrapper.getFileState(editor.id),
          project: await wrapper.getProjectState(),
        })
      )
      expect(restored.samePath).toBe(true)
      expect(restored.file).toMatchObject({ text: unsavedCode })
      expect(restored.project).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: unsavedCode }),
          expect.objectContaining({ text: dimensionsCode }),
        ])
      )

      const editedCode = unsavedCode.replace(
        'radiusValue = 10mm',
        'radiusValue = 15mm'
      )
      await editor.codeContent.fill(editedCode)
      await waitForExecutedModel(page, editedCode)
      await scene.moveCameraTo({ x: 45, y: -60, z: 45 }, { x: 0, y: 0, z: 2.5 })
      await expect
        .poll(() => presentedForeground(page), { timeout: 15_000 })
        .toBeGreaterThan(originalForeground * 1.3)
      expect(pageErrors).toHaveLength(1)
      expect(pageErrors[0].name).toBe('RuntimeError')
      expect(pageErrors[0].message).toContain('unreachable')
      expect(pageErrors[0].stack).toMatch(/wasm-function|\.wasm:/)
      await testInfo.attach('actual-wasm-panic', {
        body: JSON.stringify({
          errors: pageErrors.map(({ name, message, stack }) => ({
            name,
            message,
            stack,
          })),
          panicMessages,
          restored,
        }),
        contentType: 'application/json',
      })
    } finally {
      await original.dispose()
    }
  })
})
