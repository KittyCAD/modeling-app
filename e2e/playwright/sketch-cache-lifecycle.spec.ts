import type { Page } from '@playwright/test'
import {
  cacheModelCode as modelCode,
  cacheSceneReceipt as sceneReceipt,
} from '@e2e/playwright/lib/cache-model'
import { expect, test } from '@e2e/playwright/zoo-test'

test.use({ mockApiRoutes: false })

async function clearCommands(page: Page) {
  await page.evaluate(() => {
    const editor = window.app.project?.executingEditor.value
    if (!editor) throw new Error('No executing editor')
    editor.engineCommandManager.clearCommandLogs()
  })
}

async function originalSolidReceipt(page: Page) {
  const current = await sceneReceipt(page)
  if (!current.bodyId)
    throw new Error('The complete model must contain the original solid')
  return { ...current, bodyId: current.bodyId }
}

async function waitForEditableSketch(page: Page, previousFrame: number) {
  await expect(page.getByTestId('sketch-exit')).toBeEnabled()
  await expect(page.getByTestId('line')).toBeEnabled()
  await page.waitForFunction((previousFrame) => {
    const editor = window.app.project?.executingEditor.value
    const controls = editor?.sceneInfra.camControls
    return Boolean(
      editor &&
        !editor.hasErrors() &&
        !editor.isExecuting &&
        editor.modelingState?.matches({ sketchSolveMode: 'active' }) &&
        controls?.syncDirection === 'clientToEngine' &&
        !controls.isPerspective &&
        !controls.isFovAnimationInProgress &&
        editor.sceneInfra.renderer.info.render.frame > previousFrame &&
        Object.keys(editor.engineCommandManager.pendingCommands).length === 0
    )
  }, previousFrame)
}

async function clientFrameCount(page: Page) {
  return page.evaluate(() => {
    const editor = window.app.project?.executingEditor.value
    if (!editor) throw new Error('No executing editor')
    return editor.sceneInfra.renderer.info.render.frame
  })
}

async function waitForModeling(page: Page) {
  await expect(page.getByTestId('sketch-exit')).toBeHidden()
  await expect(page.getByTestId('sketch')).toBeEnabled()
  await page.waitForFunction(() => {
    const editor = window.app.project?.executingEditor.value
    const controls = editor?.sceneInfra.camControls
    return Boolean(
      editor &&
        !editor.hasErrors() &&
        !editor.isExecuting &&
        editor.code === editor.lastSuccessfulCode &&
        editor.modelingState?.matches('idle') &&
        controls?.syncDirection === 'engineToClient' &&
        controls.enableRotate &&
        Object.keys(editor.engineCommandManager.pendingCommands).length === 0
    )
  })
}

test.describe('Rust-owned sketch cache lifecycle', { tag: '@web' }, () => {
  test('unchanged sketch handoffs reuse the loaded solid', async ({
    page,
    fs,
    folderSetupFn,
    homePage,
    scene,
    toolbar,
    editor,
  }) => {
    test.setTimeout(90_000)
    await folderSetupFn(async (directory) => {
      const project = await fs.join(directory, 'sketch-cache-lifecycle')
      await fs.mkdir(project, { recursive: true })
      await fs.writeFile(
        await fs.join(project, 'main.kcl'),
        new TextEncoder().encode(modelCode)
      )
    })
    await page.evaluate(() => {
      const settings = window.app.settings.actor
      settings.send({
        type: 'set.modeling.defaultUnit',
        data: { level: 'user', value: 'in' },
      })
      settings.send({
        type: 'set.modeling.enableSSAO',
        data: { level: 'user', value: false },
      })
      settings.send({
        type: 'set.modeling.fixedSizeGrid',
        data: { level: 'user', value: false },
      })
      settings.send({
        type: 'set.modeling.backfaceColor',
        data: { level: 'user', value: '#123456' },
      })
      settings.send({
        type: 'set.modeling.showScaleGrid',
        data: { level: 'user', value: false },
      })
    })
    await page.waitForFunction(() =>
      window.app.settings.actor.getSnapshot().matches('idle')
    )
    await page.setBodyDimensions({ width: 1200, height: 800 })
    await homePage.openProject('sketch-cache-lifecycle')
    await scene.settled()
    await page.evaluate(async () => {
      const editor = window.app.project?.executingEditor.value
      if (!editor) throw new Error('No executing editor')
      await editor.flushPendingEditorExecution()
    })
    await waitForModeling(page)
    const original = await originalSolidReceipt(page)
    expect(original.code).toBe(modelCode)
    expect(original.engineBodyIds).toContain(original.bodyId)
    expect(original.preferences).toEqual({
      enableSsao: false,
      fixedSizeGrid: false,
      backfaceColor: '#123456',
      defaultUnit: 'in',
    })
    // The program's explicit millimeters win over the actor's inch default.
    expect(original.fileUnit).toBe('mm')
    await toolbar.openFeatureTreePane()

    const expectRetainedSolid = async (baseline = original) => {
      // edit_sketch intentionally publishes a sketch-only mock outcome. Its
      // variables may omit body; the engine must still own the original solid.
      const current = await sceneReceipt(page)
      expect(current.sessionId).toBe(baseline.sessionId)
      expect(current.engineBodyIds).toContain(baseline.bodyId)
      expect(current.commands).not.toContain('set_kcl_version')
      expect(current.commands).not.toContain('scene_clear_all')
      expect(current.commands).not.toContain('edge_lines_visible')
      expect(current.commands).not.toContain('set_grid_scale')
      expect(current.commands).not.toContain('set_grid_auto_scale')
      expect(current.commands).not.toContain('set_default_system_properties')
      expect(current.preferences).toEqual(original.preferences)
      expect(current.fileUnit).toBe(original.fileUnit)
      return current
    }

    await test.step('Start Sketch and select a plane without rebuilding the solid', async () => {
      await clearCommands(page)
      const frame = await clientFrameCount(page)
      await toolbar.startSketchBtn.click()
      await page
        .getByRole('button', { name: 'Top plane XY', exact: true })
        .click()
      await waitForEditableSketch(page, frame)
      await expectRetainedSolid()
    })

    const newSketchName =
      await test.step('Create a real line so the new sketch persists', async () => {
        await toolbar.lineBtn.click()
        await expect(toolbar.lineBtn).toHaveAttribute('aria-pressed', 'true')
        const [start] = scene.makeMouseHelpers(0.7, 0.25, { format: 'ratio' })
        const [end] = scene.makeMouseHelpers(0.8, 0.35, { format: 'ratio' })
        const emptySketchCode = await editor.getCurrentCode()
        await start()
        await expect
          .poll(() => editor.getCurrentCode())
          .not.toBe(emptySketchCode)
        const startedLineCode = await editor.getCurrentCode()
        await end()
        await expect
          .poll(() => editor.getCurrentCode())
          .not.toBe(startedLineCode)
        await toolbar.lineBtn.click()
        await expect(toolbar.lineBtn).toHaveAttribute('aria-pressed', 'false')
        await expect(
          page.locator('[data-handle="sketch-point-handle"]')
        ).toHaveCount(2)
        const code = await editor.getCurrentCode()
        const name = [...code.matchAll(/^(\w+) = sketch\(on = XY\)/gm)]
          .map((match) => match[1])
          .find((name) => name !== 'profile')
        if (!name) throw new Error('The UI must create a new named sketch')
        return name
      })

    const committed =
      await test.step('Commit the edited sketch and warm its updated program', async () => {
        await clearCommands(page)
        await toolbar.exitSketchBtn.click()
        await waitForModeling(page)
        // Drawing changed the sketch's AST. Its first commit may rebuild; the
        // unchanged enter/exit handoff below must reuse this committed program.
        const current = await originalSolidReceipt(page)
        expect(current.sessionId).toBe(original.sessionId)
        expect(current.bodyId).toBe(original.bodyId)
        expect(current.engineBodyIds).toContain(original.bodyId)
        return current
      })

    await test.step('Edit the newly created sketch without rebuilding the original solid', async () => {
      await clearCommands(page)
      const frame = await clientFrameCount(page)
      const operation = await toolbar.getFeatureTreeOperation(newSketchName, 0)
      await operation.dblclick()
      await waitForEditableSketch(page, frame)
      await expect(
        page.locator('[data-handle="sketch-point-handle"]')
      ).toHaveCount(2)
      const current = await expectRetainedSolid(committed)
      expect(current.code).toBe(committed.code)
    })

    await test.step('Return to a usable model with the original solid', async () => {
      await clearCommands(page)
      await toolbar.exitSketchBtn.click()
      await waitForModeling(page)
      const current = await expectRetainedSolid(committed)
      expect(current.bodyId).toBe(committed.bodyId)
      expect(current.code).toBe(committed.code)
    })
  })
})
