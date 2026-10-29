import { throwTronAppMissing } from '@e2e/playwright/lib/electron-helpers'
import {
  cacheModelCode as modelCode,
  cacheSceneReceipt as modelReceipt,
  presentedEngineFrame,
} from '@e2e/playwright/lib/cache-model'
import { TEST_SETTINGS } from '@e2e/playwright/storageStates'
import { expect, test } from '@e2e/playwright/zoo-test'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { PNG } from 'pngjs'

test.use({ mockApiRoutes: false })

function dominantFraction(frame: PNG, channel: number) {
  expect(frame.width).toBeGreaterThanOrEqual(64)
  expect(frame.height).toBeGreaterThanOrEqual(64)
  let matching = 0
  let total = 0
  for (let y = Math.floor(frame.height / 4); y < (frame.height * 3) / 4; y++)
    for (let x = Math.floor(frame.width / 4); x < (frame.width * 3) / 4; x++) {
      const index = (y * frame.width + x) * 4
      total++
      if (
        frame.data[index + channel] >= 96 &&
        [0, 1, 2].every(
          (other) =>
            other === channel ||
            frame.data[index + channel] > frame.data[index + other] + 48
        )
      )
        matching++
    }
  return matching / total
}

test.describe('Live backface settings', { tag: '@desktop' }, () => {
  test('backface colors update the existing model without executing KCL', async ({
    page,
    tronApp,
    folderSetupFn,
    homePage,
    scene,
    cmdBar,
  }) => {
    test.setTimeout(90_000)
    if (!tronApp) throwTronAppMissing()
    await tronApp.cleanProjectDir({
      ...TEST_SETTINGS,
      modeling: { ...TEST_SETTINGS.modeling, show_scale_grid: false },
    })
    await folderSetupFn(async (directory) => {
      const project = path.join(directory, 'backface-cache')
      await fsp.mkdir(project, { recursive: true })
      await fsp.writeFile(path.join(project, 'main.kcl'), modelCode)
    })
    await page.setBodyDimensions({ width: 1200, height: 700 })
    await homePage.openProject('backface-cache')
    await scene.settled()
    await page.waitForFunction(() => {
      const editor = window.app.project?.executingEditor.value
      return (
        editor &&
        !editor.hasErrors() &&
        !editor.isExecutingSignal.value &&
        editor.variables.body?.type === 'Solid' &&
        editor.artifactGraph.size > 0 &&
        Object.keys(editor.engineCommandManager.pendingCommands).length === 0
      )
    })
    // Inside the cylinder, looking horizontally at its inner wall, not its front.
    await scene.moveCameraTo({ x: 0, y: 0, z: 2.5 }, { x: 20, y: 0, z: 2.5 })
    const camera = await scene.getCameraInfo()
    expect(camera.position).toEqual([0, 0, 2.5])
    expect(camera.target).toEqual([20, 0, 2.5])
    const original = await modelReceipt(page)
    expect(original.code).toBe(modelCode)
    expect(original.bodyId).not.toBeNull()
    expect(original.engineBodyIds).toEqual([original.bodyId])
    await page.evaluate(() => {
      const editor = window.app.project?.executingEditor.value
      if (!editor) throw new Error('No executing editor')
      editor.engineCommandManager.clearCommandLogs()
    })
    const assertUnchangedModel = async () => {
      const current = await modelReceipt(page)
      expect(current).toMatchObject({
        path: original.path,
        code: original.code,
        bodyId: original.bodyId,
        sessionId: original.sessionId,
        hasErrors: false,
        isExecuting: false,
        executions: 0,
      })
      expect(current.artifacts).toEqual(original.artifacts)
      expect(current.engineBodyIds).toEqual(original.engineBodyIds)
    }

    for (const color of [
      { name: 'red', hex: '#ff0000', channel: 0 },
      { name: 'green', hex: '#00ff00', channel: 1 },
      { name: 'blue', hex: '#0000ff', channel: 2 },
    ]) {
      await test.step(`${color.name} backfaces are rendered without rebuilding the body`, async () => {
        await cmdBar.openCmdBar()
        await cmdBar.chooseCommand('Settings · modeling · backface color')
        await cmdBar.currentArgumentInput.fill(color.hex)
        await cmdBar.progressCmdBar()
        await page.waitForFunction((hex) => {
          const editor = window.app.project?.executingEditor.value
          return (
            window.app.settings.actor.getSnapshot().matches('idle') &&
            window.app.settings
              .get()
              .modeling.backfaceColor.current.toLowerCase() === hex &&
            editor &&
            !editor.isExecutingSignal.value &&
            Object.keys(editor.engineCommandManager.pendingCommands).length ===
              0
          )
        }, color.hex)
        await assertUnchangedModel()
        let frame: Buffer | undefined
        try {
          await expect
            .poll(async () => {
              const presented = await presentedEngineFrame(page)
              frame = presented.buffer
              return dominantFraction(presented.image, color.channel)
            })
            .toBeGreaterThanOrEqual(0.7)
        } catch (error) {
          if (frame)
            await test.info().attach(`backface-${color.name}.png`, {
              body: frame,
              contentType: 'image/png',
            })
          throw error
        }
        await assertUnchangedModel()
      })
    }
  })
})
