import type { Page } from '@playwright/test'
import { throwTronAppMissing } from '@e2e/playwright/lib/electron-helpers'
import { TEST_SETTINGS } from '@e2e/playwright/storageStates'
import { expect, test } from '@e2e/playwright/zoo-test'
import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import type { DeepPartial } from '@src/lib/types'
import { isArray } from '@src/lib/utils'
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

async function clearCommands(page: Page) {
  await page.evaluate(() => {
    const editor = window.app.project?.executingEditor.value
    if (!editor) throw new Error('No executing editor')
    editor.engineCommandManager.clearCommandLogs()
  })
}

async function sceneReceipt(page: Page) {
  const snapshot = await page.evaluate(async () => {
    const editor = window.app.project?.executingEditor.value
    if (!editor) throw new Error('No executing editor')
    const body = editor.variables.body
    const response = await editor.engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: crypto.randomUUID(),
      cmd: {
        type: 'scene_get_entity_ids',
        filter: ['solid3d'],
        skip: 0,
        take: 100,
      },
    })
    return {
      response,
      code: editor.code,
      filePath: editor.path,
      lastSuccessfulCode: editor.lastSuccessfulCode,
      defaultPlanes: editor.rustContext.defaultPlanes,
      bodyId: body?.type === 'Solid' ? body.value.id : null,
      sessionId: editor.engineCommandManager.engineSessionId,
      commands: editor.engineCommandManager.commandLogs.flatMap((log) => {
        // Rust modeling commands are recorded on their real acknowledgements,
        // including the individual replies from a modeling batch.
        if (log.type === 'receive-reliable')
          return log.cmd_type ? [log.cmd_type] : []
        if (log.type !== 'send-scene' && log.type !== 'send-modeling') return []
        if (log.data.type === 'modeling_cmd_req') return [log.data.cmd.type]
        if (log.data.type === 'modeling_cmd_batch_req')
          return log.data.requests.map((request) => request.cmd.type)
        return []
      }),
    }
  })
  const { response, ...model } = snapshot
  const reply = isArray(response) ? response[0] : response
  if (
    !reply ||
    !reply.success ||
    !('resp' in reply) ||
    reply.resp.type !== 'modeling' ||
    reply.resp.data.modeling_response.type !== 'scene_get_entity_ids'
  )
    throw new Error('The real engine must return its live solid IDs')
  return {
    ...model,
    engineBodyIds: reply.resp.data.modeling_response.data.entity_ids
      .flat()
      .sort(),
  }
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

test.describe('Rust-owned sketch cache lifecycle', { tag: '@desktop' }, () => {
  test('public execution rejects an unregistered file without changing cached geometry or default planes', async ({
    page,
    tronApp,
    folderSetupFn,
    homePage,
    scene,
  }) => {
    test.setTimeout(90_000)
    if (!tronApp) throwTronAppMissing()
    const settings = {
      ...TEST_SETTINGS,
      modeling: { ...TEST_SETTINGS.modeling, show_scale_grid: false },
    }
    const theme = TEST_SETTINGS.app?.appearance?.theme
    const baseUnit = TEST_SETTINGS.modeling?.base_unit
    const enableSsao = TEST_SETTINGS.modeling?.enable_ssao
    const fixedSizeGrid = TEST_SETTINGS.modeling?.fixed_size_grid
    if (
      theme === undefined ||
      baseUnit === undefined ||
      enableSsao === undefined ||
      fixedSizeGrid === undefined
    )
      throw new Error('The execution fixture settings must be defined')
    const executionSettings = {
      settings: {
        app: { appearance: { theme } },
        modeling: {
          base_unit: baseUnit,
          enable_ssao: enableSsao,
          fixed_size_grid: fixedSizeGrid,
          show_scale_grid: false,
        },
      },
    } satisfies DeepPartial<Configuration>
    await tronApp.cleanProjectDir(settings)
    await folderSetupFn(async (directory) => {
      const project = path.join(directory, 'cache-owner-defense')
      await fsp.mkdir(project, { recursive: true })
      await fsp.writeFile(path.join(project, 'main.kcl'), modelCode)
    })
    await homePage.openProject('cache-owner-defense')
    await scene.settled()
    await page.evaluate(async () => {
      const editor = window.app.project?.executingEditor.value
      if (!editor) throw new Error('No executing editor')
      await editor.flushPendingEditorExecution()
    })
    await waitForModeling(page)
    // The deliberate invalid call and the valid control use exactly the same
    // AST/configuration as this legitimate, warmed public execution.
    const warm = await page.evaluate(async (executionSettings) => {
      const editor = window.app.project?.executingEditor.value
      if (!editor) throw new Error('No executing editor')
      const outcome = await editor.rustContext.execute(
        editor.ast,
        executionSettings,
        editor.path
      )
      return { fromCache: outcome.fromCache }
    }, executionSettings)
    expect(warm.fromCache).toBe(true)
    const original = await originalSolidReceipt(page)
    expect(original.code).toBe(modelCode)
    expect(original.defaultPlanes).not.toBeNull()
    expect(original.engineBodyIds).toContain(original.bodyId)
    const wrongPath = path.join(
      path.dirname(original.filePath),
      'unregistered-owner.kcl'
    )
    expect(wrongPath).not.toBe(original.filePath)
    await clearCommands(page)

    const attempted = await page.evaluate(
      async ({ executionSettings, wrongPath }) => {
        const editor = window.app.project?.executingEditor.value
        if (!editor) throw new Error('No executing editor')
        try {
          await editor.rustContext.execute(
            editor.ast,
            executionSettings,
            wrongPath
          )
          return {
            rejected: false,
            message: null,
            defaultPlanes: editor.rustContext.defaultPlanes,
          }
        } catch (error) {
          return {
            rejected: true,
            message: error instanceof Error ? error.message : String(error),
            defaultPlanes: editor.rustContext.defaultPlanes,
          }
        }
      },
      { executionSettings, wrongPath }
    )
    const after = await originalSolidReceipt(page)
    await test.info().attach('unregistered-execution-owner', {
      body: JSON.stringify({ original, attempted, after }, null, 2),
      contentType: 'application/json',
    })
    expect(attempted.rejected).toBe(true)
    expect(attempted.message).toContain('does not match registered active file')
    expect(attempted.defaultPlanes).toEqual(original.defaultPlanes)
    expect(after.defaultPlanes).toEqual(original.defaultPlanes)
    expect(after.filePath).toBe(original.filePath)
    expect(after.code).toBe(original.code)
    expect(after.lastSuccessfulCode).toBe(original.lastSuccessfulCode)
    expect(after.sessionId).toBe(original.sessionId)
    expect(after.bodyId).toBe(original.bodyId)
    expect(after.engineBodyIds).toEqual(original.engineBodyIds)
    expect(after.commands).not.toContain('set_kcl_version')
    expect(after.commands).not.toContain('scene_clear_all')

    const valid = await page.evaluate(async (executionSettings) => {
      const editor = window.app.project?.executingEditor.value
      if (!editor) throw new Error('No executing editor')
      const outcome = await editor.rustContext.execute(
        editor.ast,
        executionSettings,
        editor.path
      )
      return {
        fromCache: outcome.fromCache,
        defaultPlanes: outcome.defaultPlanes,
      }
    }, executionSettings)
    expect(valid.fromCache).toBe(true)
    expect(valid.defaultPlanes).toEqual(original.defaultPlanes)
    const retained = await originalSolidReceipt(page)
    expect(retained.defaultPlanes).toEqual(original.defaultPlanes)
    expect(retained.filePath).toBe(original.filePath)
    expect(retained.code).toBe(original.code)
    expect(retained.lastSuccessfulCode).toBe(original.lastSuccessfulCode)
    expect(retained.sessionId).toBe(original.sessionId)
    expect(retained.bodyId).toBe(original.bodyId)
    expect(retained.engineBodyIds).toEqual(original.engineBodyIds)
    expect(retained.commands).not.toContain('set_kcl_version')
    expect(retained.commands).not.toContain('scene_clear_all')
    await waitForModeling(page)
  })

  test('unchanged sketch handoffs reuse the loaded solid', async ({
    page,
    tronApp,
    folderSetupFn,
    homePage,
    scene,
    toolbar,
    editor,
  }) => {
    test.setTimeout(90_000)
    if (!tronApp) throwTronAppMissing()
    await tronApp.cleanProjectDir({
      ...TEST_SETTINGS,
      modeling: { ...TEST_SETTINGS.modeling, show_scale_grid: false },
    })
    await folderSetupFn(async (directory) => {
      const project = path.join(directory, 'sketch-cache-lifecycle')
      await fsp.mkdir(project, { recursive: true })
      await fsp.writeFile(path.join(project, 'main.kcl'), modelCode)
    })
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
    await toolbar.openFeatureTreePane()

    const expectRetainedSolid = async (baseline = original) => {
      // edit_sketch intentionally publishes a sketch-only mock outcome. Its
      // variables may omit body; the engine must still own the original solid.
      const current = await sceneReceipt(page)
      expect(current.sessionId).toBe(baseline.sessionId)
      expect(current.engineBodyIds).toContain(baseline.bodyId)
      expect(current.commands).not.toContain('set_kcl_version')
      expect(current.commands).not.toContain('scene_clear_all')
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
