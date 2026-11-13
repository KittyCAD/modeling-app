import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@e2e/playwright/zoo-test'
import type { Fixtures } from '@e2e/playwright/fixtures/fixtureSetup'
import { normalizeLineEndings } from '@src/lib/codeEditor'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

test.use({ mockApiRoutes: false })

async function center(locator: Locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('Expected a visible tooltip trigger')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

function toolbarTooltip(page: Page, id: string) {
  return page.getByTestId(id).locator('..').getByRole('tooltip')
}

function openTooltips(page: Page) {
  return page.locator('[role="tooltip"][popover]:popover-open')
}

async function expectCurrentToolbarTooltip(page: Page, id: string) {
  const trigger = page.getByTestId(id)
  const description = await trigger.getAttribute('aria-description')
  if (!description) throw new Error('Expected a toolbar description')
  const tooltip = toolbarTooltip(page, id)
  await expect(tooltip).toBeVisible()
  await expect(tooltip.locator('p').first()).toHaveText(description)
  await expect(openTooltips(page)).toHaveCount(1)
  return tooltip
}

async function prepareTooltipModel({
  page,
  fs,
  folderSetupFn,
  homePage,
  scene,
}: Pick<Fixtures, 'fs' | 'folderSetupFn' | 'homePage' | 'scene'> & {
  page: Page
}) {
  await page.setBodyDimensions({ width: 1200, height: 800 })
  const sample = await readFile(
    join('rust', 'kcl-lib', 'tests', 'named_views_hide_extrude', 'input.kcl'),
    'utf8'
  )
  // Real scalar rows make the existing feature tree scroll without adding
  // expensive geometry or constructing a separate tooltip-only UI.
  const scalarRows = Array.from(
    { length: 28 },
    (_, index) => `tooltipValue${index} = ${index}mm`
  ).join('\n')
  // Exercise Windows file contents on every platform. Editors normalize to LF.
  const fileCode =
    `@settings(kclVersion = 3.0)\n${sample}\n${scalarRows}\n`.replace(
      /\r?\n/g,
      '\r\n'
    )
  const code = normalizeLineEndings(fileCode)
  await folderSetupFn(async (directory) => {
    const project = await fs.join(directory, 'tooltip-interactions')
    await fs.mkdir(project, { recursive: true })
    await fs.writeFile(
      await fs.join(project, 'main.kcl'),
      new TextEncoder().encode(fileCode)
    )
  })
  await homePage.openProject('tooltip-interactions')
  await scene.connectionEstablished()
  await scene.settled()
  await page.evaluate(async () => {
    const editor = window.app.project?.executingEditor.value
    if (!editor) throw new Error('No executing editor')
    await editor.flushPendingEditorExecution()
  })
  await expect
    .poll(() =>
      page.evaluate(() => {
        const editor = window.app.project?.executingEditor.value
        if (!editor) return undefined
        return {
          code: editor.code,
          lastSuccessfulCode: editor.lastSuccessfulCode,
          isExecuting: editor.isExecuting,
          hasErrors: editor.hasErrors(),
          boxType: editor.variables.boxVisible?.type,
          pendingCommands: Object.keys(
            editor.engineCommandManager.pendingCommands
          ).length,
        }
      })
    )
    .toEqual({
      code,
      lastSuccessfulCode: code,
      isExecuting: false,
      hasErrors: false,
      boxType: 'Solid',
      pendingCommands: 0,
    })
  await page.mouse.move(0, 0)
  await expect(openTooltips(page)).toHaveCount(0)
}

test.describe(
  'Tooltip pointer ownership',
  { tag: ['@desktop', '@web'] },
  () => {
    test.beforeEach(prepareTooltipModel)

    test('fast toolbar sweeps keep the latest content and allow card boundaries and clicks', async ({
      page,
      toolbar,
    }) => {
      const ids = [
        'extrude',
        'sweep',
        'loft',
        'revolve',
        'fillet3d',
        'chamfer3d',
        'shell',
        'hole',
      ]
      const points = await Promise.all(
        ids.map((id) => center(page.getByTestId(id)))
      )
      for (const point of [...points, ...points.toReversed()]) {
        await page.mouse.move(point.x, point.y)
      }
      const tooltip = await expectCurrentToolbarTooltip(page, 'extrude')
      const buttonPoint = await center(page.getByTestId('extrude'))
      const cardPoint = await center(tooltip)

      // Native moves cross the actual transparent padding between the button
      // and interactive rich card. Neither side may close the other prematurely.
      await page.mouse.move(cardPoint.x, cardPoint.y, { steps: 8 })
      await expectCurrentToolbarTooltip(page, 'extrude')
      const link = tooltip.getByRole('link').first()
      await expect(link).toBeVisible()
      expect(
        await link.evaluate((link) => {
          const box = link.getBoundingClientRect()
          return link.contains(
            document.elementFromPoint(
              box.x + box.width / 2,
              box.y + box.height / 2
            )
          )
        })
      ).toBe(true)
      await page.mouse.move(buttonPoint.x, buttonPoint.y, { steps: 8 })
      await expectCurrentToolbarTooltip(page, 'extrude')

      for (let index = 0; index < 3; index++) {
        await page.mouse.move(0, 0)
        await page.mouse.move(buttonPoint.x, buttonPoint.y)
      }
      await expectCurrentToolbarTooltip(page, 'extrude')
      await page.mouse.move(0, 0)
      await expect(openTooltips(page)).toHaveCount(0)

      await toolbar.startSketchBtn.hover()
      await expectCurrentToolbarTooltip(page, 'sketch')
      const sketchPoint = await center(toolbar.startSketchBtn)
      // One native click, without actionability retries hiding interception.
      await page.mouse.click(sketchPoint.x, sketchPoint.y)
      await expect(
        page.getByText('Select a plane or face to start sketching.')
      ).toBeVisible()
    })

    test('feature-tree sweeps and native scrolling discard stale tooltips without intercepting row selection', async ({
      page,
      toolbar,
      editor,
    }) => {
      await toolbar.openFeatureTreePane()
      await toolbar.featureTreePane
        .getByRole('button', { name: '28 Parameters', exact: true })
        .click()
      const scroller = toolbar.featureTreePane.getByTestId('debug-panel')
      await expect
        .poll(() =>
          scroller.evaluate((node) => node.scrollHeight - node.clientHeight)
        )
        .toBeGreaterThan(0)
      const first = await toolbar.getFeatureTreeOperation('tooltipValue0', 0)
      await first.scrollIntoViewIfNeeded()
      const bounds = await scroller.boundingBox()
      if (!bounds) throw new Error('Expected a visible feature tree')
      const rows = toolbar.featureTreePane.locator(
        '[data-testid="feature-tree-operation-item"] > button'
      )
      const boxes = await Promise.all(
        (await rows.all()).map((row) => row.boundingBox())
      )
      const visible = boxes.filter(
        (box) =>
          box &&
          box.y >= bounds.y &&
          box.y + box.height <= bounds.y + bounds.height
      )
      expect(visible.length).toBeGreaterThan(3)
      for (const box of [...visible, ...visible.toReversed()]) {
        if (box)
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      }

      await first.hover()
      const oldTooltip = first.getByRole('tooltip')
      await expect(oldTooltip).toBeVisible()
      await expect(oldTooltip).toContainText('tooltipValue0')
      const scrollTop = await scroller.evaluate((node) => node.scrollTop)
      await page.mouse.wheel(0, 600)
      await expect
        .poll(() => scroller.evaluate((node) => node.scrollTop))
        .toBeGreaterThan(scrollTop)
      await expect(oldTooltip).not.toBeVisible()

      const next = await toolbar.getFeatureTreeOperation('tooltipValue24', 0)
      await next.hover()
      await expect(next.getByRole('tooltip')).toBeVisible()
      await expect(next.getByRole('tooltip')).toContainText('tooltipValue24')
      await expect(openTooltips(page)).toHaveCount(1)
      const point = await center(next)
      await page.mouse.click(point.x, point.y)
      await editor.expectActiveLinesToBe(['tooltipValue24 = 24mm'])
      await page.mouse.move(0, 0)
      await expect(openTooltips(page)).toHaveCount(0)
    })
  }
)

test.describe('Toolbar activation tooltip ownership', { tag: '@web' }, () => {
  test.beforeEach(prepareTooltipModel)

  test('Activating and reopening a toolbar command dismisses its interactive rich tooltip', async ({
    page,
    toolbar,
  }) => {
    const button = toolbar.revolveButton
    const dialog = page.getByRole('region', { name: 'Revolve', exact: true })
    const palette = page.getByTestId('command-bar-wrapper')
    // The reported failure happened on the second Revolve activation.
    for (let activation = 0; activation < 2; activation++) {
      await button.hover()
      const tooltip = await expectCurrentToolbarTooltip(page, 'revolve')
      // Clicking readable card content must not activate the command or dismiss
      // the card. Do not navigate its external documentation links in this test.
      await tooltip.locator('p').first().click()
      await expect(tooltip).toBeVisible()
      await expect(dialog.or(palette)).not.toBeVisible()
      await button.hover()
      const point = await center(button)
      // A native click must dismiss help before the next selection action.
      await page.mouse.click(point.x, point.y)
      await expect(tooltip).not.toBeVisible()
      await expect(openTooltips(page)).toHaveCount(0)

      await expect(dialog.or(palette)).toBeVisible()
      if (await dialog.isVisible()) {
        const profiles = dialog.getByRole('button', {
          name: 'Select Profiles',
          exact: true,
        })
        await expect(profiles).toBeEnabled()
        await profiles.click()
        await expect(profiles).toHaveAttribute('aria-pressed', 'true')
        await dialog
          .getByRole('button', { name: 'Cancel', exact: true })
          .click()
      } else {
        await expect(page.getByTestId('command-name')).toHaveText('Revolve')
        const profiles = palette.locator('#arg-form input[name="selection"]')
        await expect(profiles.locator('..')).toBeVisible()
        await expect(profiles).toBeEnabled()
        await profiles.click()
        await expect(profiles).toBeFocused()
        await page.getByTestId('command-bar-close-button').click()
      }
      await expect(dialog.or(palette)).not.toBeVisible()
    }
  })
})
