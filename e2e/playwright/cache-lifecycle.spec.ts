import type { Page } from '@playwright/test'
import { throwTronAppMissing } from '@e2e/playwright/lib/electron-helpers'
import { TEST_SETTINGS } from '@e2e/playwright/storageStates'
import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'
import fsp from 'node:fs/promises'
import path from 'node:path'

test.use({ mockApiRoutes: false })

const modelCode = `@settings(defaultLengthUnit = mm, kclVersion = 3.0)
radiusValue = 10mm
height = 5mm
profile = sketch(on = XY) {
  perimeter = circle(start = [var 10mm, var 0mm], center = [var 0mm, var 0mm])
  coincident([perimeter.center, ORIGIN])
  radius(perimeter) == radiusValue
  horizontal([perimeter.center, perimeter.start])
}
body = extrude(region(segments = [profile.perimeter]), length = height)
`
const syntaxErrorCode = `${modelCode}\nbroken = (\n`
const lexicalErrorCode = `${modelCode}\nbroken = "unterminated\n`

async function waitForValidModel(page: Page, code: string) {
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

async function waitForParseFailure(page: Page, code: string) {
  await expect
    .poll(
      () =>
        page.evaluate((code) => {
          const editor = window.app.project?.executingEditor.value
          return Boolean(
            editor &&
              editor.code.trim() === code.trim() &&
              editor.hasParseErrors() &&
              editor.hasErrors() &&
              editor.diagnostics.some(({ severity }) => severity === 'error') &&
              !editor.isExecutingSignal.value &&
              Object.keys(editor.engineCommandManager.pendingCommands)
                .length === 0
          )
        }, code),
      { timeout: 15_000 }
    )
    .toBe(true)
  await expect(page.locator('.cm-lint-marker-error').first()).toBeVisible()
}

async function modelReceipt(page: Page) {
  return page.evaluate(() => {
    const editor = window.app.project?.executingEditor.value
    if (!editor) throw new Error('No executing editor')
    return {
      path: editor.path,
      code: editor.code,
      lastSuccessfulCode: editor.lastSuccessfulCode,
      artifacts: [...editor.artifactGraph.keys()].sort(),
      connectionId: editor.engineCommandManager.engineSessionId,
      apiCallId: editor.engineCommandManager.apiCallId,
    }
  })
}

async function presentedModel(page: Page) {
  return page.locator('#video-stream').evaluate((video) => {
    if (
      !(video instanceof HTMLVideoElement) ||
      video.paused ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    )
      throw new Error('The actual engine video is not playing')
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Unable to read the presented engine frame')
    context.drawImage(video, 0, 0)
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    const background = (canvas.width + 1) * 4
    let foregroundPixels = 0
    let centerPixels = 0
    let centerForegroundPixels = 0
    for (let y = Math.floor(canvas.height / 5); y < canvas.height * 0.8; y++)
      for (let x = Math.floor(canvas.width / 5); x < canvas.width * 0.8; x++) {
        const index = (y * canvas.width + x) * 4
        const foreground =
          Math.abs(data[index] - data[background]) +
            Math.abs(data[index + 1] - data[background + 1]) +
            Math.abs(data[index + 2] - data[background + 2]) >=
          80
        if (foreground) foregroundPixels++
        if (
          x >= canvas.width * 0.475 &&
          x < canvas.width * 0.525 &&
          y >= canvas.height * 0.475 &&
          y < canvas.height * 0.525
        ) {
          centerPixels++
          if (foreground) centerForegroundPixels++
        }
      }
    return {
      foregroundPixels,
      centerForegroundFraction: centerForegroundPixels / centerPixels,
      streamId:
        video.srcObject instanceof MediaStream ? video.srcObject.id : null,
    }
  })
}

test.describe(
  'Rust-owned execution cache lifecycle',
  { tag: '@desktop' },
  () => {
    test('same-file lexical and syntax errors retain the model, another invalid file clears it', async ({
      page,
      tronApp,
      folderSetupFn,
      homePage,
      toolbar,
      editor,
      scene,
    }) => {
      test.setTimeout(90_000)
      if (!tronApp) throwTronAppMissing()
      await tronApp.cleanProjectDir({
        ...TEST_SETTINGS,
        modeling: { ...TEST_SETTINGS.modeling, show_scale_grid: false },
      })
      await folderSetupFn(async (directory) => {
        const project = path.join(directory, 'cache-file-identity')
        await fsp.mkdir(project, { recursive: true })
        await fsp.writeFile(path.join(project, 'main.kcl'), modelCode)
        // Identical invalid bytes must not make a different file inherit A's scene.
        await fsp.writeFile(path.join(project, 'invalid.kcl'), syntaxErrorCode)
      })
      await homePage.openProject('cache-file-identity')
      await scene.settled()
      await waitForValidModel(page, modelCode)
      await scene.moveCameraTo({ x: 45, y: -60, z: 45 }, { x: 0, y: 0, z: 2.5 })
      await expect
        .poll(async () => (await presentedModel(page)).centerForegroundFraction)
        .toBeGreaterThan(0.9)
      const original = await modelReceipt(page)

      await toolbar.openPane(DefaultLayoutPaneID.Code)
      for (const invalidCode of [lexicalErrorCode, syntaxErrorCode]) {
        const successful = await modelReceipt(page)
        await editor.codeContent.fill(invalidCode)
        await waitForParseFailure(page, invalidCode)
        const retained = await modelReceipt(page)
        expect(retained.path).toBe(original.path)
        expect(retained.lastSuccessfulCode).toBe(successful.lastSuccessfulCode)
        expect(retained.artifacts).toEqual(successful.artifacts)
        await expect
          .poll(
            async () => (await presentedModel(page)).centerForegroundFraction
          )
          .toBeGreaterThan(0.9)
        if (invalidCode === lexicalErrorCode) {
          await editor.codeContent.fill(modelCode)
          await waitForValidModel(page, modelCode)
        }
      }

      await toolbar.openPane(DefaultLayoutPaneID.Files)
      await toolbar.openFile('invalid.kcl')
      await waitForParseFailure(page, syntaxErrorCode)
      await expect
        .poll(async () => (await modelReceipt(page)).path)
        .not.toBe(original.path)
      await expect
        .poll(async () => (await modelReceipt(page)).artifacts)
        .toEqual([])
      await expect
        .poll(async () => (await presentedModel(page)).foregroundPixels)
        .toBe(0)
    })

    test('a real socket teardown reconstructs the current file and accepts the next edit', async ({
      page,
      tronApp,
      folderSetupFn,
      homePage,
      toolbar,
      editor,
      scene,
    }) => {
      test.setTimeout(90_000)
      if (!tronApp) throwTronAppMissing()
      await tronApp.cleanProjectDir({
        ...TEST_SETTINGS,
        modeling: { ...TEST_SETTINGS.modeling, show_scale_grid: false },
      })
      await folderSetupFn(async (directory) => {
        const project = path.join(directory, 'cache-engine-session')
        await fsp.mkdir(project, { recursive: true })
        await fsp.writeFile(path.join(project, 'main.kcl'), modelCode)
      })
      await homePage.openProject('cache-engine-session')
      await scene.settled()
      await waitForValidModel(page, modelCode)
      await toolbar.openPane(DefaultLayoutPaneID.Code)
      await scene.moveCameraTo({ x: 45, y: -60, z: 45 }, { x: 0, y: 0, z: 2.5 })
      await expect
        .poll(async () => (await presentedModel(page)).centerForegroundFraction)
        .toBeGreaterThan(0.9)
      const before = await modelReceipt(page)
      const beforeFrame = await presentedModel(page)
      expect(before.connectionId).toBeTruthy()
      expect(before.apiCallId).toBeTruthy()
      expect(beforeFrame.streamId).toBeTruthy()

      // Close the real live socket. Its production close handler owns teardown,
      // reconnect and rebuilding; no fabricated event or cache API is involved.
      await page.evaluate(() => {
        const connection =
          window.app.project?.executingEditor.value?.engineCommandManager
            .connection
        if (connection?.websocket?.readyState !== WebSocket.OPEN)
          throw new Error('The real engine socket is not open')
        connection.websocket.close(1000, 'cache lifecycle reconnect regression')
      })
      await expect
        .poll(async () => (await modelReceipt(page)).connectionId, {
          timeout: 30_000,
        })
        .not.toBe(before.connectionId)
      await waitForValidModel(page, modelCode)
      await scene.settled()
      const after = await modelReceipt(page)
      expect(after.path).toBe(before.path)
      expect(after.connectionId).toBeTruthy()
      expect(after.apiCallId).toBeTruthy()
      expect(after.apiCallId).not.toBe(before.apiCallId)
      await expect
        .poll(async () => (await presentedModel(page)).streamId)
        .not.toBe(beforeFrame.streamId)
      await scene.moveCameraTo({ x: 45, y: -60, z: 45 }, { x: 0, y: 0, z: 2.5 })
      await expect
        .poll(async () => (await presentedModel(page)).centerForegroundFraction)
        .toBeGreaterThan(0.9)
      const rebuiltFrame = await presentedModel(page)

      const editedCode = modelCode.replace(
        'radiusValue = 10mm',
        'radiusValue = 15mm'
      )
      await editor.codeContent.fill(editedCode)
      await waitForValidModel(page, editedCode)
      await expect
        .poll(async () => (await presentedModel(page)).foregroundPixels)
        .toBeGreaterThan(rebuiltFrame.foregroundPixels * 1.3)
      expect((await modelReceipt(page)).connectionId).toBe(after.connectionId)
    })
  }
)
