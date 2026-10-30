import type { Page } from '@playwright/test'
import {
  cacheModelCode as modelCode,
  cacheSceneReceipt as modelReceipt,
  cacheSceneVolume,
  waitForExecutedModel as waitForValidModel,
} from '@e2e/playwright/lib/cache-model'
import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

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

async function expectCylinderVolume(page: Page, radius: number) {
  const expected = Math.PI * radius ** 2 * 5
  await expect
    .poll(async () => Math.abs((await cacheSceneVolume(page)) / expected - 1))
    .toBeLessThan(0.001)
}

test.describe('Rust-owned execution cache lifecycle', { tag: '@web' }, () => {
  test('same-file lexical and syntax errors retain the model, another invalid file clears it', async ({
    page,
    fs,
    folderSetupFn,
    homePage,
    toolbar,
    editor,
    scene,
  }) => {
    test.setTimeout(90_000)
    await folderSetupFn(async (directory) => {
      const project = await fs.join(directory, 'cache-file-identity')
      await fs.mkdir(project, { recursive: true })
      await fs.writeFile(
        await fs.join(project, 'main.kcl'),
        new TextEncoder().encode(modelCode)
      )
      // Identical invalid bytes must not make a different file inherit A's scene.
      await fs.writeFile(
        await fs.join(project, 'invalid.kcl'),
        new TextEncoder().encode(syntaxErrorCode)
      )
    })
    await homePage.openProject('cache-file-identity')
    await scene.settled()
    await waitForValidModel(page, modelCode)
    const original = await modelReceipt(page)
    expect(original.bodyId).toBeTruthy()
    expect(original.engineBodyIds).toContain(original.bodyId)

    await toolbar.openPane(DefaultLayoutPaneID.Code)
    for (const invalidCode of [lexicalErrorCode, syntaxErrorCode]) {
      const successful = await modelReceipt(page)
      await editor.codeContent.fill(invalidCode)
      await waitForParseFailure(page, invalidCode)
      const retained = await modelReceipt(page)
      expect(retained.path).toBe(original.path)
      expect(retained.lastSuccessfulCode).toBe(successful.lastSuccessfulCode)
      expect(retained.artifacts).toEqual(successful.artifacts)
      expect(retained.engineBodyIds).toEqual(successful.engineBodyIds)
      if (invalidCode === lexicalErrorCode) {
        await editor.codeContent.fill(modelCode)
        await waitForValidModel(page, modelCode)
      }
    }

    await toolbar.openPane(DefaultLayoutPaneID.Files)
    await toolbar.openFile('invalid.kcl')
    // Wait for the file handoff before accepting the previous file's diagnostics.
    const invalidPath = await fs.join(
      await fs.dirname(original.path),
      'invalid.kcl'
    )
    await expect
      .poll(() =>
        page.evaluate(() => window.app.project?.executingEditor.value?.path)
      )
      .toBe(invalidPath)
    await waitForParseFailure(page, syntaxErrorCode)
    const invalid = await modelReceipt(page)
    expect(invalid.path).not.toBe(original.path)
    expect(invalid.artifacts).toEqual([])
    expect(invalid.engineBodyIds).toEqual([])
  })

  for (const duringExecution of [false, true]) {
    test(
      duringExecution
        ? 'a real socket teardown during execution reconstructs the current file and accepts the next edit'
        : 'a real socket teardown reconstructs the current file and accepts the next edit',
      async ({ page, fs, folderSetupFn, homePage, toolbar, editor, scene }) => {
        test.setTimeout(90_000)
        await folderSetupFn(async (directory) => {
          const project = await fs.join(directory, 'cache-engine-session')
          await fs.mkdir(project, { recursive: true })
          await fs.writeFile(
            await fs.join(project, 'main.kcl'),
            new TextEncoder().encode(modelCode)
          )
        })
        await homePage.openProject('cache-engine-session')
        await scene.settled()
        await waitForValidModel(page, modelCode)
        await toolbar.openPane(DefaultLayoutPaneID.Code)
        const before = await modelReceipt(page)
        expect(before.sessionId).toBeTruthy()
        expect(before.apiCallId).toBeTruthy()
        expect(before.bodyId).toBeTruthy()
        expect(before.engineBodyIds).toContain(before.bodyId)
        await expectCylinderVolume(page, 10)

        const interruptedCode = duringExecution
          ? modelCode.replace('radiusValue = 10mm', 'radiusValue = 12mm')
          : modelCode
        if (duringExecution) {
          // Close atomically while a real Wasm modeling command awaits its reply.
          // A scene query or an already-finished execution cannot satisfy this.
          const interrupted = page.waitForFunction((code) => {
            const current = window.app.project?.executingEditor.value
            const manager = current?.engineCommandManager
            const socket = manager?.connection?.websocket
            if (
              !current ||
              current.code.trim() !== code.trim() ||
              !current.isExecutingSignal.value ||
              !Object.values(manager?.pendingCommands ?? {}).some(
                (pending) => !pending.isSceneCommand
              ) ||
              socket?.readyState !== WebSocket.OPEN
            )
              return false
            const session = manager?.engineSessionId
            socket.close(1000, 'cache lifecycle in-flight reconnect regression')
            return session
          }, interruptedCode)
          const [interruptedSession] = await Promise.all([
            interrupted,
            editor.codeContent.fill(interruptedCode),
          ])
          expect(await interruptedSession.jsonValue()).toBe(before.sessionId)
          await interruptedSession.dispose()
        } else {
          await page.evaluate(() => {
            const socket =
              window.app.project?.executingEditor.value?.engineCommandManager
                .connection?.websocket
            if (socket?.readyState !== WebSocket.OPEN)
              throw new Error('The real engine socket is not open')
            socket.close(1000, 'cache lifecycle reconnect regression')
          })
        }
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                window.app.project?.executingEditor.value?.engineCommandManager
                  .engineSessionId
            )
          )
          .not.toBe(before.sessionId)
        await scene.settled()
        await waitForValidModel(page, interruptedCode)
        const after = await modelReceipt(page)
        expect(after.path).toBe(before.path)
        expect(after.sessionId).toBeTruthy()
        expect(after.sessionId).not.toBe(before.sessionId)
        expect(after.apiCallId).toBeTruthy()
        expect(after.apiCallId).not.toBe(before.apiCallId)
        expect(after.bodyId).toBeTruthy()
        expect(after.engineBodyIds).toContain(after.bodyId)
        await expectCylinderVolume(page, duringExecution ? 12 : 10)

        const editedCode = modelCode.replace(
          'radiusValue = 10mm',
          'radiusValue = 15mm'
        )
        await editor.codeContent.fill(editedCode)
        await waitForValidModel(page, editedCode)
        await expectCylinderVolume(page, 15)
        expect((await modelReceipt(page)).sessionId).toBe(after.sessionId)
      }
    )
  }
})
