import { throwTronAppMissing } from '@e2e/playwright/lib/electron-helpers'
import { TEST_SETTINGS } from '@e2e/playwright/storageStates'
import { expect, test } from '@e2e/playwright/zoo-test'
import type { Page } from '@playwright/test'
import { isArray } from '@src/lib/utils'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { PNG } from 'pngjs'

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

async function modelReceipt(page: Page) {
  const snapshot = await page.evaluate(async () => {
    const editor = window.app.project?.executingEditor.value
    if (!editor) throw new Error('No executing editor')
    const body = editor.variables.body
    if (body?.type !== 'Solid')
      throw new Error('The model must contain a solid')
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
      path: editor.path,
      code: editor.code,
      bodyId: body.value.id,
      artifacts: [...editor.artifactGraph.keys()].sort(),
      sessionId: editor.engineCommandManager.engineSessionId,
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

async function presentedFrame(page: Page) {
  const dataUrl = await page.locator('#video-stream').evaluate((video) => {
    if (
      !(video instanceof HTMLVideoElement) ||
      video.paused ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    )
      throw new Error('The actual engine video must be playing')
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Unable to read the presented engine frame')
    context.drawImage(video, 0, 0)
    return canvas.toDataURL('image/png')
  })
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
}

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
    expect(original.engineBodyIds).toEqual([original.bodyId])
    await page.evaluate(() => {
      const editor = window.app.project?.executingEditor.value
      if (!editor) throw new Error('No executing editor')
      editor.engineCommandManager.clearCommandLogs()
    })
    const assertUnchangedModel = async () => {
      expect(await modelReceipt(page)).toEqual(original)
      expect(
        await page.evaluate(() => {
          const editor = window.app.project?.executingEditor.value
          if (!editor || editor.hasErrors() || editor.isExecutingSignal.value)
            return -1
          return editor.engineCommandManager.commandLogs.filter(
            (entry) => entry.type === 'execution-done'
          ).length
        })
      ).toBe(0)
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
              frame = await presentedFrame(page)
              return dominantFraction(PNG.sync.read(frame), color.channel)
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
