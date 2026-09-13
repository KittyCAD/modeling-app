import { join } from 'path'
import * as fsp from 'fs/promises'

import { getUtils } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import { uuidv4 } from '@src/lib/utils'
import { NAMED_VIEWS_UI_FEATURE_FLAG } from '@src/lib/constants'
import { DefaultLayoutPaneID } from '@src/lib/layout'

/** Declared apart from `MAIN_KCL` so a test can remove exactly this view. */
const TOP_VIEW_KCL = `topDown = view::named(
  "Top",
  camera = view::oriented(view::Orientation::Top, distance = 200mm),
  baseline = view::Visibility::Show,
)`

/** A view no project file declares until a test types it in. */
const SIDE_VIEW_KCL = `
sideOn = view::named(
  "Side",
  camera = view::oriented(view::Orientation::Right),
  baseline = view::Visibility::Show,
)
`

/**
 * Two modules each declaring a view named `Front`, which is the case the
 * switcher has to render apart. `panel.kcl` declares one, this file declares the
 * other, and `Top` is unique so it stays unprefixed.
 */
const MAIN_KCL = `@settings(experimentalFeatures = allow)

import panelFront from "panel.kcl"

plateSketch = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 40mm, var 0mm])
  edge2 = line(start = [var 40mm, var 0mm], end = [var 40mm, var 30mm])
  edge3 = line(start = [var 40mm, var 30mm], end = [var 0mm, var 30mm])
  edge4 = line(start = [var 0mm, var 30mm], end = [var 0mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
}
plateRegion = region(point = [20mm, 15mm], sketch = plateSketch)
plate = extrude(plateRegion, length = 5mm)

localFront = view::named(
  "Front",
  camera = view::oriented(view::Orientation::Back),
  baseline = view::Visibility::Show,
)

${TOP_VIEW_KCL}

importedFront = panelFront
`

/** `MAIN_KCL` with the `Top` declaration taken out, as an edit would. */
const MAIN_KCL_WITHOUT_TOP = MAIN_KCL.replace(`${TOP_VIEW_KCL}\n\n`, '')

const PANEL_KCL = `@settings(experimentalFeatures = allow)

export panelFront = view::named(
  "Front",
  camera = view::oriented(view::Orientation::Front),
  baseline = view::Visibility::Show,
)
`

/**
 * A Top view with its own target and distance, which is the case the quaternion
 * route has to honour instead of re-centring on the current camera target.
 */
const TOP_TARGET_KCL = `@settings(experimentalFeatures = allow)

plateSketch = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 40mm, var 0mm])
  edge2 = line(start = [var 40mm, var 0mm], end = [var 40mm, var 30mm])
  edge3 = line(start = [var 40mm, var 30mm], end = [var 0mm, var 30mm])
  edge4 = line(start = [var 0mm, var 30mm], end = [var 0mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
}
plateRegion = region(point = [20mm, 15mm], sketch = plateSketch)
plate = extrude(plateRegion, length = 5mm)

topAt = view::named(
  "TopAt",
  camera = view::oriented(
    view::Orientation::Top,
    target = [10mm, 20mm, 0mm],
    distance = 100mm,
  ),
  baseline = view::Visibility::Show,
)
`

const VIEW_SWITCHER_PANE = `#${DefaultLayoutPaneID.NamedViews}-pane`
const VIEW_SWITCHER_BUTTON = `${DefaultLayoutPaneID.NamedViews}-pane-button`

async function writeTopTargetProject(dir: string) {
  const projectDir = join(dir, 'top-target')
  await fsp.mkdir(projectDir, { recursive: true })
  await fsp.writeFile(join(projectDir, 'main.kcl'), TOP_TARGET_KCL, 'utf-8')
}

async function writeProject(dir: string) {
  const projectDir = join(dir, 'named-views')
  await fsp.mkdir(projectDir, { recursive: true })
  await fsp.writeFile(join(projectDir, 'main.kcl'), MAIN_KCL, 'utf-8')
  await fsp.writeFile(join(projectDir, 'panel.kcl'), PANEL_KCL, 'utf-8')
}

/**
 * DELETE THIS BLOCK when `NAMED_VIEWS_UI_FEATURE_FLAG` is removed. Its claim is
 * that the switcher is absent, which stops being true at that point.
 */
test.describe('KCL named views, feature flag off', { tag: '@desktop' }, () => {
  // The switcher's absence is only meaningful when the flag is off. The harness
  // mocks `/user/features` and returns exactly the flags a spec declares, so
  // this empty list states that precondition here rather than leaving it to the
  // fixture default. Granting the flag on the Zoo org cannot reach this test.
  test.use({ userFeatures: [] })

  test('the view switcher has no rail button and no pane', async ({
    homePage,
    scene,
    page,
    folderSetupFn,
  }) => {
    await folderSetupFn(writeProject)
    await homePage.openProject('named-views')
    await scene.settled()

    await expect(page.getByTestId(VIEW_SWITCHER_BUTTON)).toHaveCount(0)
    await expect(page.locator(VIEW_SWITCHER_PANE)).toHaveCount(0)
  })
})

test.describe('KCL named views', { tag: '@desktop' }, () => {
  // Delete this line when the flag is removed. No test below refers to it.
  test.use({ userFeatures: [NAMED_VIEWS_UI_FEATURE_FLAG] })

  test('the rail button opens and closes the switcher', async ({
    homePage,
    scene,
    toolbar,
    page,
    folderSetupFn,
  }) => {
    await folderSetupFn(writeProject)
    await homePage.openProject('named-views')
    await scene.settled()

    await expect(page.getByTestId(VIEW_SWITCHER_BUTTON)).toBeVisible()
    await expect(page.locator(VIEW_SWITCHER_PANE)).toHaveCount(0)

    await toolbar.openPane(DefaultLayoutPaneID.NamedViews)
    await expect(page.locator(VIEW_SWITCHER_PANE)).toBeVisible()

    await toolbar.closePane(DefaultLayoutPaneID.NamedViews)
    await expect(page.locator(VIEW_SWITCHER_PANE)).toHaveCount(0)
  })

  test('numbers the rows from 1, lists Default View first, and prefixes a name two modules declare', async ({
    homePage,
    scene,
    toolbar,
    page,
    folderSetupFn,
  }) => {
    await folderSetupFn(writeProject)
    await homePage.openProject('named-views')
    await scene.settled()
    await toolbar.openPane(DefaultLayoutPaneID.NamedViews)

    const labels = page
      .locator(VIEW_SWITCHER_PANE)
      .getByTestId('named-view-label')
    const numbers = page
      .locator(VIEW_SWITCHER_PANE)
      .getByTestId('named-view-number')
    const rows = page.locator(VIEW_SWITCHER_PANE).getByTestId('named-view-row')

    // Graph insertion order: the `import` executes before the local
    // declarations, so the imported view is registered first.
    await expect(labels).toHaveText([
      'Default View',
      'panel::Front',
      'main::Front',
      'Top',
    ])
    // The number is the row's position in the list, so `Default View` is 1.
    await expect(numbers).toHaveText(['1', '2', '3', '4'])
    await expect(rows.first()).toHaveAttribute('data-active', 'true')
  })

  test('activating a view moves the active marker and returns it', async ({
    homePage,
    scene,
    toolbar,
    page,
    folderSetupFn,
  }) => {
    await folderSetupFn(writeProject)
    await homePage.openProject('named-views')
    await scene.settled()
    await toolbar.openPane(DefaultLayoutPaneID.NamedViews)

    const rows = page.locator(VIEW_SWITCHER_PANE).getByTestId('named-view-row')
    const defaultView = rows.filter({ hasText: 'Default View' })
    const top = rows.filter({ hasText: 'Top' })

    await top.click()
    await expect(top).toHaveAttribute('data-active', 'true')
    await expect(defaultView).toHaveAttribute('data-active', 'false')

    await defaultView.click()
    await expect(defaultView).toHaveAttribute('data-active', 'true')
    await expect(top).toHaveAttribute('data-active', 'false')
  })

  /**
   * Guards the active-view pointer against an execution, not the reapply. The
   * scene the reapply sends is covered by the unit tests, which can read the
   * batch; nothing in the DOM reports engine visibility.
   */
  test('an edit leaves the active view marked', async ({
    homePage,
    scene,
    toolbar,
    editor,
    page,
    folderSetupFn,
  }) => {
    await folderSetupFn(writeProject)
    await homePage.openProject('named-views')
    await scene.settled()
    await toolbar.openPane(DefaultLayoutPaneID.NamedViews)

    const rows = page.locator(VIEW_SWITCHER_PANE).getByTestId('named-view-row')
    const top = rows.filter({ hasText: 'Top' })

    await top.click()
    await expect(top).toHaveAttribute('data-active', 'true')

    await editor.openPane()
    await editor.replaceCode('', MAIN_KCL + SIDE_VIEW_KCL)

    // The new row is the signal that the execution finished and the pane read
    // the graph it produced.
    await expect(rows.filter({ hasText: 'Side' })).toHaveCount(1)
    await expect(top).toHaveAttribute('data-active', 'true')
  })

  test('deleting the active view returns to Default View and says so', async ({
    homePage,
    scene,
    toolbar,
    editor,
    page,
    folderSetupFn,
  }) => {
    await folderSetupFn(writeProject)
    await homePage.openProject('named-views')
    await scene.settled()
    await toolbar.openPane(DefaultLayoutPaneID.NamedViews)

    const rows = page.locator(VIEW_SWITCHER_PANE).getByTestId('named-view-row')
    const top = rows.filter({ hasText: 'Top' })
    const defaultView = rows.filter({ hasText: 'Default View' })

    await top.click()
    await expect(top).toHaveAttribute('data-active', 'true')

    await editor.openPane()
    await editor.replaceCode('', MAIN_KCL_WITHOUT_TOP)

    await expect(top).toHaveCount(0)
    await expect(defaultView).toHaveAttribute('data-active', 'true')
    await expect(
      page.getByText('The view "Top" is no longer in this program.')
    ).toBeVisible()
  })

  test('a Top view centres on its own target, not the current one', async ({
    homePage,
    scene,
    toolbar,
    page,
    folderSetupFn,
  }) => {
    const u = await getUtils(page)
    await folderSetupFn(writeTopTargetProject)
    await homePage.openProject('top-target')
    await scene.settled()
    await u.openDebugPanel()
    await toolbar.openPane(DefaultLayoutPaneID.NamedViews)

    await u.clearCommandLogs()
    await page
      .locator(VIEW_SWITCHER_PANE)
      .getByTestId('named-view-row')
      .filter({ hasText: 'TopAt' })
      .click()

    // Top and bottom take the quaternion route rather than a look-at.
    await u.waitForCmdReceive('default_camera_set_view')
    await u.clearCommandLogs()
    await u.sendCustomCmd({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_get_settings',
      },
    })
    await u.waitForCmdReceive('default_camera_get_settings')

    // The view's target, not the model's centre.
    await expect(page.getByTestId('cam-x-position')).toHaveValue('10')
    await expect(page.getByTestId('cam-y-position')).toHaveValue('20')
    await expect(page.getByTestId('cam-z-position')).toHaveValue('100')
  })
})
