import { test, expect } from '@playwright/test'
import { secrets } from './secrets'
import { Paths, doExport, getUtils } from './test-utils'
import { Models } from '@kittycad/lib'
import fsp from 'fs/promises'
import { spawn } from 'child_process'
import { KCL_DEFAULT_LENGTH } from 'lib/constants'
import JSZip from 'jszip'
import path from 'path'
import {
  IS_PLAYWRIGHT_KEY,
  TEST_SETTINGS,
  TEST_SETTINGS_KEY,
} from './storageStates'
import * as TOML from '@iarna/toml'

test.beforeEach(async ({ page }) => {
  // reducedMotion kills animations, which speeds up tests and reduces flakiness
  await page.emulateMedia({ reducedMotion: 'reduce' })

  // set the default settings
  await page.addInitScript(
    async ({ token, settingsKey, settings, IS_PLAYWRIGHT_KEY }) => {
      localStorage.setItem('TOKEN_PERSIST_KEY', token)
      localStorage.setItem('persistCode', ``)
      localStorage.setItem(settingsKey, settings)
      localStorage.setItem(IS_PLAYWRIGHT_KEY, 'true')
    },
    {
      token: secrets.token,
      settingsKey: TEST_SETTINGS_KEY,
      settings: TOML.stringify({ settings: TEST_SETTINGS }),
      IS_PLAYWRIGHT_KEY: IS_PLAYWRIGHT_KEY,
    }
  )

  // Make the user avatar image always 404
  // so we see the fallback menu icon for all snapshot tests
  await page.route('https://lh3.googleusercontent.com/**', async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'text/plain',
      body: 'Not Found!',
    })
  })
})

test.setTimeout(60_000)

// We test this end to end already - getting this to work on web just to take
// a snapshot of it feels weird. I'd rather our regular tests fail.
// The primary failure is doExport now relies on the filesystem. We can follow
// up with another PR if we want this back.
test.skip(
  'exports of each format should work',
  { tag: ['@snapshot', '@skipWin', '@skipMacos'] },
  async ({ page, context }) => {
    // FYI this test doesn't work with only engine running locally
    // And you will need to have the KittyCAD CLI installed
    const u = await getUtils(page)
    await context.addInitScript(async () => {
      ;(window as any).playwrightSkipFilePicker = true
      localStorage.setItem(
        'persistCode',
        `topAng = 25
bottomAng = 35
baseLen = 3.5
baseHeight = 1
totalHeightHalf = 2
armThick = 0.5
totalLen = 9.5
part001 = startSketchOn('-XZ')
  |> startProfileAt([0, 0], %)
  |> yLine(baseHeight, %)
  |> xLine(baseLen, %)
  |> angledLineToY({
        angle = topAng,
        to = totalHeightHalf,
      }, %, $seg04)
  |> xLineTo(totalLen, %, $seg03)
  |> yLine(-armThick, %, $seg01)
  |> angledLineThatIntersects({
        angle = HALF_TURN,
        offset = -armThick,
        intersectTag = seg04
      }, %)
  |> angledLineToY([segAng(seg04, %) + 180, ZERO], %)
  |> angledLineToY({
        angle = -bottomAng,
        to = -totalHeightHalf - armThick,
      }, %, $seg02)
  |> xLineTo(segEndX(seg03, %) + 0, %)
  |> yLine(-segLen(seg01, %), %)
  |> angledLineThatIntersects({
        angle = HALF_TURN,
        offset = -armThick,
        intersectTag = seg02
      }, %)
  |> angledLineToY([segAng(seg02, %) + 180, -baseHeight], %)
  |> xLineTo(ZERO, %)
  |> close()
  |> extrude(length = 4)`
      )
    })
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.waitForCmdReceive('extrude')
    await page.waitForTimeout(1000)
    await u.clearAndCloseDebugPanel()

    const axisDirectionPair: Models['AxisDirectionPair_type'] = {
      axis: 'z',
      direction: 'positive',
    }
    const sysType: Models['System_type'] = {
      forward: axisDirectionPair,
      up: axisDirectionPair,
    }

    const exportLocations: Paths[] = []

    // NOTE it was easiest to leverage existing types and have doExport take Models['OutputFormat_type'] as in input
    // just note that only `type` and `storage` are used for selecting the drop downs is the app
    // the rest are only there to make typescript happy

    // TODO - failing because of an exporter issue, ADD BACK IN WHEN ITS FIXED
    // exportLocations.push(
    //   await doExport(
    //     {
    //       type: 'step',
    //       coords: sysType,
    //     },
    //     page
    //   )
    // )
    exportLocations.push(
      await doExport(
        {
          type: 'ply',
          coords: sysType,
          selection: { type: 'default_scene' },
          storage: 'ascii',
          units: 'in',
        },
        page
      )
    )
    exportLocations.push(
      await doExport(
        {
          type: 'ply',
          storage: 'binary_little_endian',
          coords: sysType,
          selection: { type: 'default_scene' },
          units: 'in',
        },
        page
      )
    )
    exportLocations.push(
      await doExport(
        {
          type: 'ply',
          storage: 'binary_big_endian',
          coords: sysType,
          selection: { type: 'default_scene' },
          units: 'in',
        },
        page
      )
    )
    exportLocations.push(
      await doExport(
        {
          type: 'stl',
          storage: 'ascii',
          coords: sysType,
          units: 'in',
          selection: { type: 'default_scene' },
        },
        page
      )
    )
    exportLocations.push(
      await doExport(
        {
          type: 'stl',
          storage: 'binary',
          coords: sysType,
          units: 'in',
          selection: { type: 'default_scene' },
        },
        page
      )
    )
    exportLocations.push(
      await doExport(
        {
          // obj seems to be a little flaky, times out tests sometimes
          type: 'obj',
          coords: sysType,
          units: 'in',
        },
        page
      )
    )
    exportLocations.push(
      await doExport(
        {
          type: 'gltf',
          storage: 'embedded',
          presentation: 'pretty',
        },
        page
      )
    )
    exportLocations.push(
      await doExport(
        {
          type: 'gltf',
          storage: 'binary',
          presentation: 'pretty',
        },
        page
      )
    )
    exportLocations.push(
      await doExport(
        {
          type: 'gltf',
          storage: 'standard',
          presentation: 'pretty',
        },
        page
      )
    )

    // close page to disconnect websocket since we can only have one open atm
    await page.close()

    // snapshot exports, good compromise to capture that exports are healthy without getting bogged down in "did the formatting change" changes
    // context: https://github.com/KittyCAD/modeling-app/issues/1222
    for (let { modelPath, imagePath, outputType } of exportLocations) {
      // May change depending on the file being dealt with
      let cliCommand = `export ZOO_TOKEN=${secrets.snapshottoken} && zoo file snapshot --output-format=png --src-format=${outputType} ${modelPath} ${imagePath}`
      const fileSize = (await fsp.stat(modelPath)).size
      console.log(`Size of the file at ${modelPath}: ${fileSize} bytes`)

      const parentPath = path.dirname(modelPath)

      // This is actually a zip file.
      if (modelPath.includes('gltf-standard.gltf')) {
        console.log('Extracting files from archive')
        const readZipFile = fsp.readFile(modelPath)
        const unzip = (archive: any) =>
          Object.values(archive.files).map((file: any) => ({
            name: file.name,
            promise: file.async('nodebuffer'),
          }))
        const writeFiles = (files: any) =>
          Promise.all(
            files.map((file: any) =>
              file.promise.then((data: any) => {
                console.log(`Writing ${file.name}`)
                return fsp
                  .writeFile(`${parentPath}/${file.name}`, data)
                  .then(() => file.name)
              })
            )
          )

        const filenames = await readZipFile
          .then(JSZip.loadAsync)
          .then(unzip)
          .then(writeFiles)
        const gltfFilename = filenames.filter((t: string) =>
          t.includes('.gltf')
        )[0]
        if (!gltfFilename) throw new Error('No gLTF in this archive')
        cliCommand = `export ZOO_TOKEN=${secrets.snapshottoken} && zoo file snapshot --output-format=png --src-format=${outputType} ${parentPath}/${gltfFilename} ${imagePath}`
      }

      console.log(cliCommand)

      const child = spawn(cliCommand, { shell: true })
      const result = await new Promise<string>((resolve, reject) => {
        child.on('error', (code: any, msg: any) => {
          console.log('error', code, msg)
          reject('error')
        })
        child.on('exit', (code, msg) => {
          console.log('exit', code, msg)
          if (code !== 0) {
            reject(`exit code ${code} for model ${modelPath}`)
          } else {
            resolve('success')
          }
        })
        child.stderr.on('data', (data) => console.log(`stderr: ${data}`))
        child.stdout.on('data', (data) => console.log(`stdout: ${data}`))
      })
      expect(result).toBe('success')
      if (result === 'success') {
        console.log(`snapshot taken for ${modelPath}`)
      } else {
        console.log(`snapshot failed for ${modelPath}`)
      }
    }
  }
)

const extrudeDefaultPlane = async (context: any, page: any, plane: string) => {
  await context.addInitScript(async () => {
    localStorage.setItem(
      'SETTINGS_PERSIST_KEY',
      JSON.stringify({
        baseUnit: 'in',
        cameraControls: 'KittyCAD',
        defaultDirectory: '',
        defaultProjectName: 'project-$nnn',
        onboardingStatus: 'dismissed',
        showDebugPanel: true,
        textWrapping: 'On',
        theme: 'dark',
        unitSystem: 'imperial',
      })
    )
  })

  const code = `part001 = startSketchOn('${plane}')
  |> startProfileAt([7.00, 4.40], %)
  |> line(end = [6.60, -0.20])
  |> line(end = [2.80, 5.00])
  |> line(end = [-5.60, 4.40])
  |> line(end = [-5.40, -3.80])
  |> close()
  |> extrude(length = 10.00)
`
  await page.addInitScript(async (code: string) => {
    localStorage.setItem('persistCode', code)
  })

  const u = await getUtils(page)
  await page.setViewportSize({ width: 1200, height: 500 })

  await u.waitForAuthSkipAppStart()

  // wait for execution done
  await u.openDebugPanel()
  await u.expectCmdLog('[data-message-type="execution-done"]')
  await u.clearAndCloseDebugPanel()
  await page.waitForTimeout(200)
  // clear code
  await u.removeCurrentCode()
  await u.openAndClearDebugPanel()
  await u.doAndWaitForImageDiff(
    () => page.locator('.cm-content').fill(code),
    200
  )
  // wait for execution done
  await u.expectCmdLog('[data-message-type="execution-done"]')
  await u.clearAndCloseDebugPanel()

  await u.closeKclCodePanel()
  await expect(page).toHaveScreenshot({
    maxDiffPixels: 100,
    mask: [page.getByTestId('model-state-indicator')],
  })
  await u.openKclCodePanel()
}

test.describe(
  'extrude on default planes should be stable',
  { tag: '@snapshot' },
  () => {
    // FIXME: Skip on macos its being weird.
    test.skip(process.platform === 'darwin', 'Skip on macos')

    test('XY', async ({ page, context }) => {
      await extrudeDefaultPlane(context, page, 'XY')
    })

    test('XZ', async ({ page, context }) => {
      await extrudeDefaultPlane(context, page, 'XZ')
    })

    test('YZ', async ({ page, context }) => {
      await extrudeDefaultPlane(context, page, 'YZ')
    })

    test('-XY', async ({ page, context }) => {
      await extrudeDefaultPlane(context, page, '-XY')
    })

    test('-XZ', async ({ page, context }) => {
      await extrudeDefaultPlane(context, page, '-XZ')
    })

    test('-YZ', async ({ page, context }) => {
      await extrudeDefaultPlane(context, page, '-YZ')
    })
  }
)

test(
  'Draft segments should look right',
  { tag: '@snapshot' },
  async ({ page, context }) => {
    // FIXME: Skip on macos its being weird.
    test.skip(process.platform === 'darwin', 'Skip on macos')

    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    const PUR = 400 / 37.5 //pixeltoUnitRatio
    await u.waitForAuthSkipAppStart()

    await u.openDebugPanel()

    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).toBeVisible()

    // click on "Start Sketch" button
    await u.clearCommandLogs()
    await u.doAndWaitForImageDiff(
      () => page.getByRole('button', { name: 'Start Sketch' }).click(),
      200
    )

    // select a plane
    await page.mouse.click(700, 200)

    let code = `sketch001 = startSketchOn('XZ')`
    await expect(page.locator('.cm-content')).toHaveText(code)

    await page.waitForTimeout(700) // TODO detect animation ending, or disable animation

    const startXPx = 600
    await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)
    code += `profile001 = startProfileAt([7.19, -9.7], sketch001)`
    await expect(page.locator('.cm-content')).toHaveText(code)
    await page.waitForTimeout(100)

    await u.closeDebugPanel()
    await page.mouse.move(startXPx + PUR * 20, 500 - PUR * 10)
    await expect(page).toHaveScreenshot({
      maxDiffPixels: 100,
      mask: [page.getByTestId('model-state-indicator')],
    })

    const lineEndClick = () =>
      page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)
    await lineEndClick()
    await page.waitForTimeout(100)

    code += `
  |> xLine(7.25, %)`
    await expect(page.locator('.cm-content')).toHaveText(code)

    await page
      .getByRole('button', { name: 'arc Tangential Arc', exact: true })
      .click()

    // click on the end of the profile to continue it
    await page.waitForTimeout(300)
    await lineEndClick()
    await page.waitForTimeout(100)

    // click to continue profile
    await page.mouse.move(813, 392, { steps: 10 })
    await page.waitForTimeout(100)

    await page.mouse.move(startXPx + PUR * 30, 500 - PUR * 20, { steps: 10 })

    await page.waitForTimeout(1000)

    await expect(page).toHaveScreenshot({
      maxDiffPixels: 100,
      mask: [page.getByTestId('model-state-indicator')],
    })
  }
)

test(
  'Draft rectangles should look right',
  { tag: '@snapshot' },
  async ({ page, context }) => {
    // FIXME: Skip on macos its being weird.
    test.skip(process.platform === 'darwin', 'Skip on macos')

    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    const PUR = 400 / 37.5 //pixeltoUnitRatio

    await u.waitForAuthSkipAppStart()
    await u.openDebugPanel()

    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).toBeVisible()

    // click on "Start Sketch" button
    await u.clearCommandLogs()
    await u.doAndWaitForImageDiff(
      () => page.getByRole('button', { name: 'Start Sketch' }).click(),
      200
    )

    // select a plane
    await page.mouse.click(700, 200)

    await expect(page.locator('.cm-content')).toHaveText(
      `sketch001 = startSketchOn('XZ')`
    )

    await page.waitForTimeout(500) // TODO detect animation ending, or disable animation
    await u.closeDebugPanel()

    const startXPx = 600

    // Equip the rectangle tool
    await page
      .getByRole('button', { name: 'rectangle Corner rectangle', exact: true })
      .click()

    // Draw the rectangle
    await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 30)
    await page.mouse.move(startXPx + PUR * 10, 500 - PUR * 10, { steps: 5 })
    await page.waitForTimeout(800)

    // Ensure the draft rectangle looks the same as it usually does
    await expect(page).toHaveScreenshot({
      maxDiffPixels: 100,
      mask: [page.getByTestId('model-state-indicator')],
    })
  }
)
test(
  'Draft circle should look right',
  { tag: '@snapshot' },
  async ({ page, context }) => {
    // FIXME: Skip on macos its being weird.
    // test.skip(process.platform === 'darwin', 'Skip on macos')

    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    const PUR = 400 / 37.5 //pixeltoUnitRatio

    await u.waitForAuthSkipAppStart()
    await u.openDebugPanel()

    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).toBeVisible()

    // click on "Start Sketch" button
    await u.clearCommandLogs()
    await u.doAndWaitForImageDiff(
      () => page.getByRole('button', { name: 'Start Sketch' }).click(),
      200
    )

    // select a plane
    await page.mouse.click(700, 200)

    await expect(page.locator('.cm-content')).toHaveText(
      `sketch001 = startSketchOn('XZ')`
    )

    await page.waitForTimeout(500) // TODO detect animation ending, or disable animation
    await u.closeDebugPanel()

    const startXPx = 600

    // Equip the rectangle tool
    // await page.getByRole('button', { name: 'line Line', exact: true }).click()
    await page.getByTestId('circle-center').click()

    // Draw the rectangle
    await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 20)
    await page.mouse.move(startXPx + PUR * 10, 500 - PUR * 10, { steps: 5 })

    // Ensure the draft rectangle looks the same as it usually does
    await expect(page).toHaveScreenshot({
      maxDiffPixels: 100,
      mask: [page.getByTestId('model-state-indicator')],
    })
    await expect(page.locator('.cm-content')).toHaveText(
      `sketch001 = startSketchOn('XZ')profile001 = circle({ center = [14.44, -2.44], radius = 1 }, sketch001)`
    )
  }
)

test.describe(
  'Client side scene scale should match engine scale',
  { tag: '@snapshot' },
  () => {
    // FIXME: Skip on macos its being weird.
    test.skip(process.platform === 'darwin', 'Skip on macos')

    test('Inch scale', async ({ page }) => {
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })
      const PUR = 400 / 37.5 //pixeltoUnitRatio

      await u.waitForAuthSkipAppStart()
      await u.openDebugPanel()

      await expect(
        page.getByRole('button', { name: 'Start Sketch' })
      ).not.toBeDisabled()
      await expect(
        page.getByRole('button', { name: 'Start Sketch' })
      ).toBeVisible()

      // click on "Start Sketch" button
      await u.clearCommandLogs()
      await u.doAndWaitForImageDiff(
        () => page.getByRole('button', { name: 'Start Sketch' }).click(),
        200
      )

      // select a plane
      await page.mouse.click(700, 200)

      let code = `sketch001 = startSketchOn('XZ')`
      await expect(page.locator('.cm-content')).toHaveText(code)

      await page.waitForTimeout(600) // TODO detect animation ending, or disable animation

      const startXPx = 600
      await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)
      code += `profile001 = startProfileAt([7.19, -9.7], sketch001)`
      await expect(u.codeLocator).toHaveText(code)
      await page.waitForTimeout(100)

      await u.closeDebugPanel()

      await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)
      await page.waitForTimeout(100)

      code += `
  |> xLine(7.25, %)`
      await expect(u.codeLocator).toHaveText(code)

      await page
        .getByRole('button', { name: 'arc Tangential Arc', exact: true })
        .click()
      await page.waitForTimeout(100)

      // click to continue profile
      await page.mouse.click(813, 392)
      await page.waitForTimeout(100)

      await page.mouse.click(startXPx + PUR * 30, 500 - PUR * 20)

      code += `
  |> tangentialArcTo([21.7, -2.44], %)`
      await expect(u.codeLocator).toHaveText(code)

      // click tangential arc tool again to unequip it
      await page
        .getByRole('button', { name: 'arc Tangential Arc', exact: true })
        .click()
      await page.waitForTimeout(100)

      // screen shot should show the sketch
      await expect(page).toHaveScreenshot({
        maxDiffPixels: 100,
        mask: [page.getByTestId('model-state-indicator')],
      })

      // exit sketch
      await u.openAndClearDebugPanel()
      await u.doAndWaitForImageDiff(
        () => page.getByRole('button', { name: 'Exit Sketch' }).click(),
        200
      )

      // wait for execution done
      await u.expectCmdLog('[data-message-type="execution-done"]')
      await u.clearAndCloseDebugPanel()
      await page.waitForTimeout(300)

      // second screen shot should look almost identical, i.e. scale should be the same.
      await expect(page).toHaveScreenshot({
        maxDiffPixels: 100,
        mask: [page.getByTestId('model-state-indicator')],
      })
    })

    test('Millimeter scale', async ({ page }) => {
      await page.addInitScript(
        async ({ settingsKey, settings }) => {
          localStorage.setItem(settingsKey, settings)
        },
        {
          settingsKey: TEST_SETTINGS_KEY,
          settings: TOML.stringify({
            settings: {
              ...TEST_SETTINGS,
              modeling: {
                ...TEST_SETTINGS.modeling,
                defaultUnit: 'mm',
              },
            },
          }),
        }
      )
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })
      const PUR = 400 / 37.5 //pixeltoUnitRatio

      await u.waitForAuthSkipAppStart()
      await u.openDebugPanel()

      await expect(
        page.getByRole('button', { name: 'Start Sketch' })
      ).not.toBeDisabled()
      await expect(
        page.getByRole('button', { name: 'Start Sketch' })
      ).toBeVisible()

      // click on "Start Sketch" button
      await u.clearCommandLogs()
      await u.doAndWaitForImageDiff(
        () => page.getByRole('button', { name: 'Start Sketch' }).click(),
        200
      )

      // select a plane
      await page.mouse.click(700, 200)

      let code = `sketch001 = startSketchOn('XZ')`
      await expect(u.codeLocator).toHaveText(code)

      await page.waitForTimeout(600) // TODO detect animation ending, or disable animation

      const startXPx = 600
      await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)
      code += `profile001 = startProfileAt([182.59, -246.32], sketch001)`
      await expect(u.codeLocator).toHaveText(code)
      await page.waitForTimeout(100)

      await u.closeDebugPanel()

      await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)
      await page.waitForTimeout(100)

      code += `
  |> xLine(184.3, %)`
      await expect(u.codeLocator).toHaveText(code)

      await page
        .getByRole('button', { name: 'arc Tangential Arc', exact: true })
        .click()
      await page.waitForTimeout(100)

      // click to continue profile
      await page.mouse.click(813, 392)
      await page.waitForTimeout(100)

      await page.mouse.click(startXPx + PUR * 30, 500 - PUR * 20)

      code += `
  |> tangentialArcTo([551.2, -62.01], %)`
      await expect(u.codeLocator).toHaveText(code)

      await page
        .getByRole('button', { name: 'arc Tangential Arc', exact: true })
        .click()
      await page.waitForTimeout(100)

      // screen shot should show the sketch
      await expect(page).toHaveScreenshot({
        maxDiffPixels: 100,
      })

      // exit sketch
      await u.openAndClearDebugPanel()
      await u.doAndWaitForImageDiff(
        () => page.getByRole('button', { name: 'Exit Sketch' }).click(),
        200
      )

      // wait for execution done
      await u.expectCmdLog('[data-message-type="execution-done"]')
      await u.clearAndCloseDebugPanel()
      await page.waitForTimeout(300)

      // second screen shot should look almost identical, i.e. scale should be the same.
      await expect(page).toHaveScreenshot({
        maxDiffPixels: 100,
      })
    })
  }
)

test(
  'Sketch on face with none z-up',
  { tag: '@snapshot' },
  async ({ page, context }) => {
    // FIXME: Skip on macos its being weird.
    test.skip(process.platform === 'darwin', 'Skip on macos')

    const u = await getUtils(page)
    await context.addInitScript(async (KCL_DEFAULT_LENGTH) => {
      localStorage.setItem(
        'persistCode',
        `part001 = startSketchOn('-XZ')
  |> startProfileAt([1.4, 2.47], %)
  |> line(end = [9.31, 10.55], tag = $seg01)
  |> line(end = [11.91, -10.42])
  |> close()
  |> extrude(length = ${KCL_DEFAULT_LENGTH})
part002 = startSketchOn(part001, seg01)
  |> startProfileAt([8, 8], %)
  |> line(end = [4.68, 3.05])
  |> line(end = [0, -7.79])
  |> close()
  |> extrude(length = ${KCL_DEFAULT_LENGTH})
`
      )
    }, KCL_DEFAULT_LENGTH)

    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await u.openDebugPanel()
    // wait for execution done
    await expect(
      page.locator('[data-message-type="execution-done"]')
    ).toHaveCount(1, { timeout: 10_000 })
    await u.closeDebugPanel()

    // Wait for the second extrusion to appear
    // TODO: Find a way to truly know that the objects have finished
    // rendering, because an execution-done message is not sufficient.
    await page.waitForTimeout(1000)

    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()

    await page.getByRole('button', { name: 'Start Sketch' }).click()
    let previousCodeContent = await page.locator('.cm-content').innerText()

    // click at 641, 135
    await page.mouse.click(641, 135)
    await expect(page.locator('.cm-content')).not.toHaveText(
      previousCodeContent
    )
    previousCodeContent = await page.locator('.cm-content').innerText()

    await page.waitForTimeout(300)

    await expect(page).toHaveScreenshot({
      maxDiffPixels: 100,
    })
  }
)

test(
  'Zoom to fit on load - solid 2d',
  { tag: '@snapshot' },
  async ({ page, context }) => {
    // FIXME: Skip on macos its being weird.
    test.skip(process.platform === 'darwin', 'Skip on macos')

    const u = await getUtils(page)
    await context.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()
`
      )
    }, KCL_DEFAULT_LENGTH)

    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await u.openDebugPanel()
    // wait for execution done
    await expect(
      page.locator('[data-message-type="execution-done"]')
    ).toHaveCount(1)
    await u.closeDebugPanel()

    // Wait for the second extrusion to appear
    // TODO: Find a way to truly know that the objects have finished
    // rendering, because an execution-done message is not sufficient.
    await page.waitForTimeout(2000)

    await expect(page).toHaveScreenshot({
      maxDiffPixels: 100,
    })
  }
)

test(
  'Zoom to fit on load - solid 3d',
  { tag: '@snapshot' },
  async ({ page, context }) => {
    // FIXME: Skip on macos its being weird.
    test.skip(process.platform === 'darwin', 'Skip on macos')

    const u = await getUtils(page)
    await context.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()
  |> extrude(length = 10)
`
      )
    }, KCL_DEFAULT_LENGTH)

    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await u.openDebugPanel()
    // wait for execution done
    await expect(
      page.locator('[data-message-type="execution-done"]')
    ).toHaveCount(1)
    await u.closeDebugPanel()

    // Wait for the second extrusion to appear
    // TODO: Find a way to truly know that the objects have finished
    // rendering, because an execution-done message is not sufficient.
    await page.waitForTimeout(2000)

    await expect(page).toHaveScreenshot({
      maxDiffPixels: 100,
    })
  }
)

test.describe('Grid visibility', { tag: '@snapshot' }, () => {
  // FIXME: Skip on macos its being weird.
  // test.skip(process.platform === 'darwin', 'Skip on macos')

  test('Grid turned off to on via command bar', async ({ page }) => {
    const u = await getUtils(page)
    const stream = page.getByTestId('stream')
    const mask = [
      page.locator('#app-header'),
      page.locator('#sidebar-top-ribbon'),
      page.locator('#sidebar-bottom-ribbon'),
    ]

    await page.setViewportSize({ width: 1200, height: 500 })
    await page.goto('/')
    await u.waitForAuthSkipAppStart()

    await u.openDebugPanel()
    // wait for execution done
    await expect(
      page.locator('[data-message-type="execution-done"]')
    ).toHaveCount(1)
    await u.closeDebugPanel()
    await u.closeKclCodePanel()
    // TODO: Find a way to truly know that the objects have finished
    // rendering, because an execution-done message is not sufficient.
    await page.waitForTimeout(1000)

    // Open the command bar.
    await page
      .getByRole('button', { name: 'Commands', exact: false })
      .or(page.getByRole('button', { name: '⌘K' }))
      .click()
    const commandName = 'show scale grid'
    const commandOption = page.getByRole('option', {
      name: commandName,
      exact: false,
    })
    const cmdSearchBar = page.getByPlaceholder('Search commands')
    // This selector changes after we set the setting
    await cmdSearchBar.fill(commandName)
    await expect(commandOption).toBeVisible()
    await commandOption.click()

    const toggleInput = page.getByPlaceholder('Off')
    await expect(toggleInput).toBeVisible()
    await expect(toggleInput).toBeFocused()

    // Select On
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('option', { name: 'Off' })).toHaveAttribute(
      'data-headlessui-state',
      'active selected'
    )
    await page.keyboard.press('ArrowUp')
    await expect(page.getByRole('option', { name: 'On' })).toHaveAttribute(
      'data-headlessui-state',
      'active'
    )
    await page.keyboard.press('Enter')

    // Check the toast appeared
    await expect(
      page.getByText(`Set show scale grid to "true" as a user default`)
    ).toBeVisible()

    await expect(stream).toHaveScreenshot({
      maxDiffPixels: 100,
      mask,
    })
  })

  test('Grid turned off', async ({ page }) => {
    const u = await getUtils(page)
    const stream = page.getByTestId('stream')
    const mask = [
      page.locator('#app-header'),
      page.locator('#sidebar-top-ribbon'),
      page.locator('#sidebar-bottom-ribbon'),
    ]

    await page.setViewportSize({ width: 1200, height: 500 })
    await page.goto('/')
    await u.waitForAuthSkipAppStart()

    await u.openDebugPanel()
    // wait for execution done
    await expect(
      page.locator('[data-message-type="execution-done"]')
    ).toHaveCount(1)
    await u.closeDebugPanel()
    await u.closeKclCodePanel()
    // TODO: Find a way to truly know that the objects have finished
    // rendering, because an execution-done message is not sufficient.
    await page.waitForTimeout(1000)

    await expect(stream).toHaveScreenshot({
      maxDiffPixels: 100,
      mask,
    })
  })

  test('Grid turned on', async ({ page }) => {
    await page.addInitScript(
      async ({ settingsKey, settings }) => {
        localStorage.setItem(settingsKey, settings)
      },
      {
        settingsKey: TEST_SETTINGS_KEY,
        settings: TOML.stringify({
          settings: {
            ...TEST_SETTINGS,
            modeling: {
              ...TEST_SETTINGS.modeling,
              showScaleGrid: true,
            },
          },
        }),
      }
    )

    const u = await getUtils(page)
    const stream = page.getByTestId('stream')
    const mask = [
      page.locator('#app-header'),
      page.locator('#sidebar-top-ribbon'),
      page.locator('#sidebar-bottom-ribbon'),
    ]

    await page.setViewportSize({ width: 1200, height: 500 })
    await page.goto('/')
    await u.waitForAuthSkipAppStart()

    await u.openDebugPanel()
    // wait for execution done
    await expect(
      page.locator('[data-message-type="execution-done"]')
    ).toHaveCount(1)
    await u.closeDebugPanel()
    await u.closeKclCodePanel()
    // TODO: Find a way to truly know that the objects have finished
    // rendering, because an execution-done message is not sufficient.
    await page.waitForTimeout(1000)

    await expect(stream).toHaveScreenshot({
      maxDiffPixels: 100,
      mask,
    })
  })
})

test.fixme('theme persists', async ({ page, context }) => {
  const u = await getUtils(page)
  await context.addInitScript(async () => {
    localStorage.setItem(
      'persistCode',
      `part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()
  |> extrude(length = 10)
`
    )
  }, KCL_DEFAULT_LENGTH)

  await page.setViewportSize({ width: 1200, height: 500 })

  await u.waitForAuthSkipAppStart()
  await page.waitForTimeout(500)

  // await page.getByRole('link', { name: 'Settings Settings (tooltip)' }).click()
  await expect(page.getByTestId('settings-link')).toBeVisible()
  await page.getByTestId('settings-link').click()

  // open user settingns
  await page.getByRole('radio', { name: 'person User' }).click()

  await page.getByTestId('app-theme').selectOption('light')

  await page.getByTestId('settings-close-button').click()

  const networkToggle = page.getByTestId('network-toggle')

  // simulate network down
  await u.emulateNetworkConditions({
    offline: true,
    // values of 0 remove any active throttling. crbug.com/456324#c9
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })

  // Disconnect and reconnect to check the theme persists through a reload

  // Expect the network to be down
  await expect(networkToggle).toContainText('Offline')

  // simulate network up
  await u.emulateNetworkConditions({
    offline: false,
    // values of 0 remove any active throttling. crbug.com/456324#c9
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })

  await expect(networkToggle).toContainText('Connected')

  await expect(page.getByText('building scene')).not.toBeVisible()

  await expect(page, 'expect screenshot to have light theme').toHaveScreenshot({
    maxDiffPixels: 100,
  })
})

test.describe('code color goober', { tag: '@snapshot' }, () => {
  test('code color goober', async ({ page, context }) => {
    const u = await getUtils(page)
    await context.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `// Create a pipe using a sweep.

// Create a path for the sweep.
sweepPath = startSketchOn('XZ')
  |> startProfileAt([0.05, 0.05], %)
  |> line(end = [0, 7])
  |> tangentialArc({ offset = 90, radius = 5 }, %)
  |> line(end = [-3, 0])
  |> tangentialArc({ offset = -90, radius = 5 }, %)
  |> line(end = [0, 7])

sweepSketch = startSketchOn('XY')
  |> startProfileAt([2, 0], %)
  |> arc({
       angleEnd = 360,
       angleStart = 0,
       radius = 2
     }, %)
  |> sweep(path = sweepPath)
  |> appearance(
       color = "#bb00ff",
       metalness = 90,
       roughness = 90
     )
`
      )
    })

    await page.setViewportSize({ width: 1200, height: 1000 })

    await u.waitForAuthSkipAppStart()

    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.clearAndCloseDebugPanel()

    await expect(page, 'expect small color widget').toHaveScreenshot({
      maxDiffPixels: 100,
    })
  })

  test('code color goober opening window', async ({ page, context }) => {
    const u = await getUtils(page)
    await context.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `// Create a pipe using a sweep.

// Create a path for the sweep.
sweepPath = startSketchOn('XZ')
  |> startProfileAt([0.05, 0.05], %)
  |> line(end = [0, 7])
  |> tangentialArc({ offset = 90, radius = 5 }, %)
  |> line(end = [-3, 0])
  |> tangentialArc({ offset = -90, radius = 5 }, %)
  |> line(end = [0, 7])

sweepSketch = startSketchOn('XY')
  |> startProfileAt([2, 0], %)
  |> arc({
       angleEnd = 360,
       angleStart = 0,
       radius = 2
     }, %)
  |> sweep(path = sweepPath)
  |> appearance(
       color = "#bb00ff",
       metalness = 90,
       roughness = 90
     )
`
      )
    })

    await page.setViewportSize({ width: 1200, height: 1000 })

    await u.waitForAuthSkipAppStart()

    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.clearAndCloseDebugPanel()

    await expect(page.locator('.cm-css-color-picker-wrapper')).toBeVisible()

    // Click the color widget
    await page.locator('.cm-css-color-picker-wrapper input').click()

    await expect(
      page,
      'expect small color widget to have window open'
    ).toHaveScreenshot({
      maxDiffPixels: 100,
    })
  })
})
