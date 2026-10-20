import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  BudgetFixtures,
  BudgetScenario,
} from '@e2e/performance/budget-scenarios'
import { attachOutcomeDiagnostics } from '@e2e/performance/capture'
import { prepareIsolatedSolid } from '@e2e/performance/modeling-budget-scenarios'
import type { PerformanceModelProfile } from '@e2e/performance/models'
import { assertModelLoaded, modelCodeForProfile } from '@e2e/performance/models'
import { prepareModeling } from '@e2e/performance/scenarios'
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { getDimensions } from '@src/lib/engineConnection/utils'
import { delayInteractions } from '@src/lib/interactionPerformance/delayOutcomes'

const modelPath = path.join(
  'rust',
  'kcl-lib',
  'tests',
  'named_views_hide_extrude',
  'input.kcl'
)
const modelCode = async (profile: PerformanceModelProfile) =>
  modelCodeForProfile(await readFile(modelPath, 'utf8'), profile)
const toolbarTooltip = (page: Page) =>
  page.getByTestId('extrude').locator('..').locator('[role="tooltip"]').first()
const tooltipDescription = (page: Page) => toolbarTooltip(page).locator('p')
const hoverPoints = new WeakMap<Page, { x: number; y: number }>()

async function waitForSuccessfulCode(page: Page, code: string) {
  await page.waitForFunction((expected) => {
    const editor = window.app.project?.executingEditor.value
    return (
      editor?.lastSuccessfulCode === expected &&
      !editor.isExecuting &&
      editor.errors.length === 0
    )
  }, code)
}

async function preparePlanes(fixtures: BudgetFixtures, visible: boolean) {
  await prepareModeling(fixtures)
  if (visible) {
    const emptyCode =
      '// Geometry removed for the plane visibility interaction.\n'
    await fixtures.page.locator('#code-pane .cm-content').fill(emptyCode)
    await waitForSuccessfulCode(fixtures.page, emptyCode)
  }
  await fixtures.page.waitForFunction((expected) => {
    const editor = window.app.project?.executingEditor.value
    const visibility = editor?.modelingState?.context.defaultPlaneVisibility
    return (
      editor &&
      !editor.isExecuting &&
      Object.keys(editor.engineCommandManager.pendingCommands).length === 0 &&
      visibility?.xy === expected &&
      visibility.xz === expected &&
      visibility.yz === expected
    )
  }, visible)
}

async function prepareGeometryHover(fixtures: BudgetFixtures) {
  const { page } = fixtures
  const stream = await page.getByTestId('stream').boundingBox()
  if (!stream) {
    throw new Error('The modeling stream has no bounds')
  }
  // The isolated solid's proven camera points directly at a visible face. Do not
  // pre-hover it: that would prime the engine's resolved-entity cache.
  const geometryPoint = {
    x: stream.x + stream.width / 2,
    y: stream.y + stream.height / 2,
  }
  const unobstructed = await page.evaluate((point) => {
    return Boolean(
      document.elementFromPoint(point.x, point.y)?.closest('#stream')
    )
  }, geometryPoint)
  if (!unobstructed) {
    throw new Error('The isolated solid hover point is obstructed')
  }
  const outside = await page
    .locator('#code-pane .cm-scroller')
    .evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      for (const ratio of [0.5, 0.3, 0.7]) {
        const point = {
          x: bounds.x + bounds.width * ratio,
          y: bounds.y + bounds.height * ratio,
        }
        const target = document.elementFromPoint(point.x, point.y)
        if (target?.closest('#code-pane') && !target.closest('#stream')) {
          return point
        }
      }
      return null
    })
  if (!outside) {
    throw new Error('No unobstructed point outside the stream')
  }
  await page.mouse.move(outside.x, outside.y)
  await expect(page.getByTestId('hover-highlight')).toHaveCount(0)
  hoverPoints.set(page, geometryPoint)
}

export const delayBudgetScenarios: BudgetScenario[] = [
  {
    definition: delayInteractions.richTooltipReveal,
    prepare: async (fixtures) => {
      await prepareModeling(fixtures)
      await fixtures.page.mouse.move(0, 0)
      await expect(tooltipDescription(fixtures.page)).toHaveCount(0)
    },
    act: async ({ page }) => {
      await page.getByTestId('extrude').hover()
    },
    verify: async ({ page }) => {
      await expect(tooltipDescription(page)).toBeVisible()
    },
  },
  {
    definition: delayInteractions.richTooltipHide,
    prepare: async (fixtures) => {
      await prepareModeling(fixtures)
      await fixtures.page.mouse.move(0, 0)
      await expect(toolbarTooltip(fixtures.page)).not.toBeVisible()
      await fixtures.page.getByTestId('extrude').hover()
      // Hiding is the native popover's visible-to-hidden action. Rich-content
      // insertion is a separate reveal outcome, not a prerequisite for hiding.
      await expect(toolbarTooltip(fixtures.page)).toBeVisible()
    },
    act: async ({ page }) => {
      await page.mouse.move(0, 0)
    },
    verify: async ({ page }) => {
      await expect(toolbarTooltip(page)).not.toBeVisible()
    },
  },
  {
    definition: delayInteractions.editorExecution,
    unavailableWithErrors:
      'Successful automatic execution requires repairing the invalid program, which would clear the required EOF error.',
    prepare: prepareModeling,
    act: async ({ page, modelProfile }) => {
      await page
        .locator('#code-pane .cm-content')
        .fill(
          (await modelCode(modelProfile)).replace('length = 10', 'length = 12')
        )
    },
    verify: async ({ page, modelProfile }) => {
      await waitForSuccessfulCode(
        page,
        (await modelCode(modelProfile)).replace('length = 10', 'length = 12')
      )
    },
  },
  {
    definition: delayInteractions.density,
    prepare: async (fixtures) => {
      // Long analysis must finish on the loaded model, not an idle reconnect.
      await fixtures.tronApp.cleanProjectDir({
        app: { stream_idle_mode: 0 },
      })
      await prepareModeling(fixtures)
      await fixtures.page.getByTestId('physical-analysis-status').click()
      try {
        await expect(
          fixtures.page.locator('button[title="Copy physical analysis"]')
        ).toBeVisible({ timeout: 90_000 })
        await expect(
          fixtures.page.getByTestId('physical-analysis-density')
        ).not.toHaveValue('1000')
      } catch (failure) {
        await attachOutcomeDiagnostics(
          fixtures.page,
          test.info(),
          'Initial physical analysis did not settle'
        ).catch(() => {})
        throw failure
      }
    },
    act: async ({ page }) => {
      await page.getByTestId('physical-analysis-density').fill('1000')
    },
    verify: async ({ page }) => {
      await expect(
        page.locator('button[title="Copy physical analysis"]')
      ).toBeVisible()
    },
  },
  {
    definition: delayInteractions.folderDragExpand,
    prepare: async (fixtures) => {
      await prepareModeling({
        ...fixtures,
        folderSetupFn: (setup) =>
          fixtures.folderSetupFn(async (dir) => {
            await setup(dir)
            const folder = path.join(dir, 'interaction-performance', 'parts')
            await fixtures.fs.mkdir(folder, { recursive: true })
            await fixtures.fs.writeFile(
              path.join(folder, 'child.kcl'),
              new TextEncoder().encode('// File explorer drag target.\n')
            )
          }),
      })
      await fixtures.page.getByTestId('files-pane-button').click()
      const folder = fixtures.page.getByRole('treeitem', {
        name: 'parts',
        exact: true,
      })
      // Untouched folders omit aria-expanded until their first toggle. Exercise
      // the real open/close controls before capture to establish a closed row.
      await folder.click()
      await expect(folder).toHaveAttribute('aria-expanded', 'true')
      await folder.click()
      await expect(folder).toHaveAttribute('aria-expanded', 'false')
    },
    act: async ({ page }) => {
      const source = await page
        .getByRole('treeitem', { name: 'main.kcl', exact: true })
        .boundingBox()
      const target = await page
        .getByRole('treeitem', { name: 'parts', exact: true })
        .boundingBox()
      if (!source || !target) {
        throw new Error('The file drag source or target has no bounds')
      }
      await page.mouse.move(
        source.x + source.width / 2,
        source.y + source.height / 2
      )
      await page.mouse.down()
      await page.mouse.move(
        target.x + target.width / 2,
        target.y + target.height / 2,
        { steps: 8 }
      )
      // Chromium starts HTML drag-and-drop after a second movement on the target.
      await page.mouse.move(
        target.x + target.width / 2 + 1,
        target.y + target.height / 2
      )
    },
    verify: async ({ page }) => {
      try {
        await expect(
          page.getByRole('treeitem', { name: 'parts', exact: true })
        ).toHaveAttribute('aria-expanded', 'true')
        await expect(
          page.getByRole('treeitem', { name: 'child.kcl', exact: true })
        ).toBeVisible()
      } finally {
        await page.keyboard.press('Escape')
        await page.mouse.up()
      }
    },
  },
  {
    definition: delayInteractions.hoverCode,
    prepare: async (fixtures) => {
      await prepareIsolatedSolid(fixtures)
      await prepareGeometryHover(fixtures)
    },
    act: async ({ page }) => {
      const point = hoverPoints.get(page)
      if (!point) {
        throw new Error('No real geometry hover point was prepared')
      }
      await page.mouse.move(point.x, point.y)
    },
    verify: async ({ page }) => {
      await expect(page.getByTestId('hover-highlight').first()).toBeVisible()
    },
  },
  {
    definition: delayInteractions.streamResize,
    prepare: async (fixtures) => {
      await prepareModeling(fixtures)
      const { page, tronApp } = fixtures
      const browserWindow = await tronApp.electron.browserWindow(page)
      try {
        await browserWindow.evaluate((window) => {
          window.setContentSize(1200, 800)
        })
      } finally {
        await browserWindow.dispose()
      }
      const session = await page.context().newCDPSession(page)
      await session.send('Emulation.setDeviceMetricsOverride', {
        width: 0,
        height: 0,
        deviceScaleFactor: 0,
        mobile: false,
      })
      // Keep this override owner attached for the scenario. Closing the owned
      // renderer/context releases its CDP sessions along with the browser.
      // The generic dimension fixture pins these styles. Release them before
      // capture so native BrowserWindow resizes really resize the stream.
      await page.evaluate(() => {
        for (const element of [document.body, document.documentElement]) {
          element.style.removeProperty('width')
          element.style.removeProperty('height')
        }
      })
      const size = await page.getByTestId('stream').evaluate((stream) => ({
        width: stream.clientWidth,
        height: stream.clientHeight,
      }))
      await page.waitForFunction(
        (expected) => {
          const actual = window.app.engineCommandManager.streamDimensions
          const video = document.querySelector('#video-stream')
          return (
            actual.width === expected.width &&
            actual.height === expected.height &&
            video instanceof HTMLVideoElement &&
            video.videoWidth === expected.width &&
            video.videoHeight === expected.height
          )
        },
        getDimensions(size.width, size.height)
      )
    },
    act: async ({ page, tronApp }) => {
      const browserWindow = await tronApp.electron.browserWindow(page)
      try {
        await browserWindow.evaluate((window) => {
          const bounds = window.getBounds()
          window.setBounds({ ...bounds, width: bounds.width - 40 }, false)
        })
      } finally {
        await browserWindow.dispose()
      }
    },
  },
  {
    definition: delayInteractions.planesShow,
    unavailableWithErrors:
      'Executing an empty program to show default planes would replace the required erroneous buffer and clear its EOF error.',
    prepare: async (fixtures) => {
      await preparePlanes(fixtures, false)
    },
    act: async ({ page }) => {
      await page
        .locator('#code-pane .cm-content')
        .fill('// Geometry removed for the plane visibility interaction.\n')
    },
  },
  {
    definition: delayInteractions.planesHide,
    unavailableWithErrors:
      'Clearing the scene and executing valid geometry would remove the required EOF error; the error profile must retain cached geometry.',
    startsEmpty: true,
    prepare: async (fixtures) => {
      await preparePlanes(fixtures, true)
    },
    act: async ({ page, modelProfile }) => {
      await page
        .locator('#code-pane .cm-content')
        .fill(await modelCode(modelProfile))
    },
    verify: async (fixtures) => {
      await assertModelLoaded(fixtures)
    },
  },
]

export const unsupportedDelayBudgetScenarios = [
  {
    definition: delayInteractions.backfaceColor,
    reason:
      'The 500 ms debounce exists only on the native Settings color picker. Playwright color-input fill sets value and dispatches untrusted input/change events, which the recorder correctly rejects. The adjacent hex value is read-only; the command-palette color input bypasses this debounce. No supported native-picker fixture can exercise it automatically.',
  },
]
