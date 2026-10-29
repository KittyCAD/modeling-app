import type { Page } from '@playwright/test'
import {
  cacheModelCode as modelCode,
  presentedModel,
  waitForExecutedModel as waitForValidModel,
} from '@e2e/playwright/lib/cache-model'
import { throwTronAppMissing } from '@e2e/playwright/lib/electron-helpers'
import { TEST_SETTINGS } from '@e2e/playwright/storageStates'
import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'
import fsp from 'node:fs/promises'
import path from 'node:path'

test.use({ mockApiRoutes: false })

const syntaxErrorCode = `${modelCode}\nbroken = (\n`
const lexicalErrorCode = `${modelCode}\nbroken = "unterminated\n`

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
      // Both files contain the same invalid source. Wait for the file handoff
      // before accepting diagnostics left over from the original editor.
      await expect
        .poll(() =>
          page.evaluate(() => window.app.project?.executingEditor.value?.path)
        )
        .toBe(path.join(path.dirname(original.path), 'invalid.kcl'))
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
