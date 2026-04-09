import fsp from 'node:fs/promises'

import type { Page } from '@playwright/test'
import { settingsToToml } from '@e2e/playwright/test-utils'
import { TEST_SETTINGS, TEST_SETTINGS_KEY } from '@e2e/playwright/storageStates'
import { expect, test } from '@e2e/playwright/zoo-test'
import {
  SKETCH_SOLVE_DRAG_BENCHMARK_MARKS,
  SKETCH_SOLVE_DRAG_BENCHMARK_PREFIX,
} from '@src/machines/sketchSolve/sketchSolveBenchmark'

type BrowserMark = {
  name: string
  startTime: number
  detail: unknown
}

type BenchmarkSample = {
  iteration: number
  direction: 'down' | 'up'
  dragTicks: number
  rustMs: number
  sceneMs: number
  applyMs: number
  totalMs: number
}

const DEFAULT_LINE_COUNT = parseIntegerEnv('BENCHMARK_LINE_COUNT', 100)
const DEFAULT_WARMUPS = parseIntegerEnv('BENCHMARK_WARMUPS', 5)
const DEFAULT_ITERATIONS = parseIntegerEnv('BENCHMARK_ITERATIONS', 25)
const DEFAULT_DRAG_DISTANCE_PX = parseIntegerEnv(
  'BENCHMARK_DRAG_DISTANCE_PX',
  50
)
const DEFAULT_DRAG_STEPS = parseIntegerEnv('BENCHMARK_DRAG_STEPS', 5)
const DEFAULT_TARGET_LINE_INDEX = parseIntegerEnv(
  'BENCHMARK_TARGET_LINE_INDEX',
  Math.min(24, Math.max(0, Math.floor(DEFAULT_LINE_COUNT / 4)))
)
const MAX_TOTAL_MEDIAN_MS = parseOptionalNumberEnv('BENCHMARK_MAX_TOTAL_MS')

const userSettingsToml = settingsToToml({
  settings: {
    ...TEST_SETTINGS,
    modeling: {
      ...TEST_SETTINGS.modeling,
      use_sketch_solve_mode: true,
    },
  },
})

function parseIntegerEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(value) ? value : fallback
}

function parseOptionalNumberEnv(name: string): number | undefined {
  const value = Number.parseFloat(process.env[name] ?? '')
  return Number.isFinite(value) ? value : undefined
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  )
  return round(sorted[index])
}

function summarizePhase(
  samples: BenchmarkSample[],
  key: keyof BenchmarkSample
) {
  const values = samples.map((sample) => sample[key]).filter(isNumber)
  return {
    minMs: round(Math.min(...values)),
    medianMs: percentile(values, 50),
    p95Ms: percentile(values, 95),
    maxMs: round(Math.max(...values)),
  }
}

function buildBenchmarkSketch(lineCount: number): string {
  const columnCount = Math.ceil(Math.sqrt(lineCount))
  const rowCount = Math.ceil(lineCount / columnCount)
  const xSpacing = 6
  const ySpacing = 6
  const lineDx = 3.5
  const lineDy = 1.75
  const xOffset = ((columnCount - 1) * xSpacing) / 2
  const yOffset = ((rowCount - 1) * ySpacing) / 2

  const lines = Array.from({ length: lineCount }, (_, index) => {
    const row = Math.floor(index / columnCount)
    const column = index % columnCount
    const startX = round(column * xSpacing - xOffset)
    const startY = round(row * ySpacing - yOffset)
    const endX = round(startX + lineDx)
    const endY = round(startY + lineDy)

    return `  line(start = [var ${startX}mm, var ${startY}mm], end = [var ${endX}mm, var ${endY}mm])`
  })

  return `@settings(experimentalFeatures = allow)

sketch(on = XZ) {
${lines.join('\n')}
}
`
}

async function clearBenchmarkMarks(page: Page) {
  await page.evaluate(() => {
    performance.clearMarks()
    performance.clearMeasures()
  })
}

async function readBenchmarkMarks(page: Page): Promise<BrowserMark[]> {
  return page.evaluate((prefix: string) => {
    return performance
      .getEntriesByType('mark')
      .filter((entry) => entry.name.startsWith(prefix))
      .map((entry) => ({
        name: entry.name,
        startTime: entry.startTime,
        detail: entry.detail ?? null,
      }))
  }, SKETCH_SOLVE_DRAG_BENCHMARK_PREFIX)
}

function getUniqueMarkTime(marks: BrowserMark[], name: string): number {
  const matches = marks.filter((mark) => mark.name === name)
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one mark named "${name}", found ${matches.length}.`
    )
  }
  return matches[0].startTime
}

function extractBenchmarkSample(
  marks: BrowserMark[],
  iteration: number,
  direction: 'down' | 'up'
): BenchmarkSample {
  const editStarts = getMarkTimes(
    marks,
    SKETCH_SOLVE_DRAG_BENCHMARK_MARKS.editSegmentsStart
  )
  const editEnds = getMarkTimes(
    marks,
    SKETCH_SOLVE_DRAG_BENCHMARK_MARKS.editSegmentsEnd
  )
  const sceneStarts = getMarkTimes(
    marks,
    SKETCH_SOLVE_DRAG_BENCHMARK_MARKS.updateSceneGraphStart
  )
  const sceneEnds = getMarkTimes(
    marks,
    SKETCH_SOLVE_DRAG_BENCHMARK_MARKS.updateSceneGraphEnd
  )
  const outcomeStarts = getMarkTimes(
    marks,
    SKETCH_SOLVE_DRAG_BENCHMARK_MARKS.updateSketchOutcomeStart
  )
  const outcomeEnds = getMarkTimes(
    marks,
    SKETCH_SOLVE_DRAG_BENCHMARK_MARKS.updateSketchOutcomeEnd
  )
  const frameEnds = getMarkTimes(
    marks,
    SKETCH_SOLVE_DRAG_BENCHMARK_MARKS.animationFrameEnd
  )

  return {
    iteration,
    direction,
    dragTicks: editStarts.length,
    rustMs: sumPairDurations(
      editStarts,
      editEnds,
      SKETCH_SOLVE_DRAG_BENCHMARK_MARKS.editSegmentsStart
    ),
    sceneMs: sumPairDurations(
      sceneStarts,
      sceneEnds,
      SKETCH_SOLVE_DRAG_BENCHMARK_MARKS.updateSceneGraphStart
    ),
    applyMs: sumPairDurations(
      outcomeStarts,
      outcomeEnds,
      SKETCH_SOLVE_DRAG_BENCHMARK_MARKS.updateSketchOutcomeStart
    ),
    totalMs: round(frameEnds.at(-1)! - editStarts[0]),
  }
}

function getMarkTimes(marks: BrowserMark[], name: string): number[] {
  return marks
    .filter((mark) => mark.name === name)
    .map((mark) => mark.startTime)
    .sort((a, b) => a - b)
}

function sumPairDurations(
  starts: number[],
  ends: number[],
  label: string
): number {
  if (
    starts.length === 0 ||
    ends.length === 0 ||
    starts.length !== ends.length
  ) {
    throw new Error(
      `Expected matched benchmark mark pairs for "${label}", found ${starts.length} starts and ${ends.length} ends.`
    )
  }

  return round(
    starts.reduce((sum, start, index) => sum + (ends[index] - start), 0)
  )
}

async function getPointHandleCenter(page: Page, handleIndex: number) {
  const handle = page
    .locator('[data-handle="sketch-point-handle"]')
    .nth(handleIndex)
  const box = await handle.boundingBox()

  if (!box) {
    throw new Error(`Failed to resolve point handle ${handleIndex}.`)
  }

  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  }
}

async function runMeasuredDrag({
  page,
  targetHandleIndex,
  deltaY,
  steps,
}: {
  page: Page
  targetHandleIndex: number
  deltaY: number
  steps: number
}) {
  const point = await getPointHandleCenter(page, targetHandleIndex)

  await clearBenchmarkMarks(page)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x, point.y + deltaY, { steps })
  await page.mouse.up()

  await expect
    .poll(async () => {
      const marks = await readBenchmarkMarks(page)
      return getMarkTimes(
        marks,
        SKETCH_SOLVE_DRAG_BENCHMARK_MARKS.animationFrameEnd
      ).length
    })
    .toBeGreaterThan(0)

  return readBenchmarkMarks(page)
}

test.describe('Sketch solve drag benchmark', { tag: '@benchmark' }, () => {
  test('benchmarks drag latency for a dense straight-line sketch', async ({
    page,
    context,
    homePage,
    scene,
    cmdBar,
    toolbar,
    tronApp,
  }, testInfo) => {
    const lineCount = DEFAULT_LINE_COUNT
    const warmups = DEFAULT_WARMUPS
    const iterations = DEFAULT_ITERATIONS
    const dragDistancePx = DEFAULT_DRAG_DISTANCE_PX
    const dragSteps = DEFAULT_DRAG_STEPS
    const targetLineIndex = Math.min(DEFAULT_TARGET_LINE_INDEX, lineCount - 1)
    const targetHandleIndex = targetLineIndex * 2
    const minimumHandleCount = targetHandleIndex + 1
    const benchmarkSketch = buildBenchmarkSketch(lineCount)

    await test.step('Set up benchmark sketch and enable benchmark marks', async () => {
      if (tronApp) {
        await tronApp.cleanProjectDir({
          modeling: {
            use_sketch_solve_mode: true,
          },
        })
      }

      await context.addInitScript(
        async ({ code, settingsKey, settingsToml }) => {
          localStorage.setItem('persistCode', code)
          localStorage.setItem(settingsKey, settingsToml)
          ;(
            window as typeof window & {
              __zooBenchmark?: { enabled?: boolean }
            }
          ).__zooBenchmark = { enabled: true }
        },
        {
          code: benchmarkSketch,
          settingsKey: TEST_SETTINGS_KEY,
          settingsToml: userSettingsToml,
        }
      )

      await page.setBodyDimensions({ width: 1400, height: 900 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
      await expect
        .poll(() =>
          page.evaluate(() => {
            return Boolean(
              (
                window as typeof window & {
                  __zooBenchmark?: { enabled?: boolean }
                }
              ).__zooBenchmark?.enabled
            )
          })
        )
        .toBe(true)
      await toolbar.openFeatureTreePane()
      await expect(page.getByText('Building feature tree')).not.toBeVisible({
        timeout: 10000,
      })

      const solveSketchOperation = await toolbar.getFeatureTreeOperation(
        'Solve Sketch',
        0
      )
      await solveSketchOperation.dblclick()
      await page.waitForTimeout(600)
      await expect(toolbar.exitSketchBtn).toBeEnabled()
      await expect
        .poll(() => page.locator('[data-handle="sketch-point-handle"]').count())
        .toBeGreaterThanOrEqual(minimumHandleCount)
    })

    await test.step('Collect warmups', async () => {
      for (let iteration = 0; iteration < warmups; iteration += 1) {
        const direction: 'down' | 'up' = iteration % 2 === 0 ? 'down' : 'up'
        const deltaY = direction === 'down' ? dragDistancePx : -dragDistancePx
        await runMeasuredDrag({
          page,
          targetHandleIndex,
          deltaY,
          steps: dragSteps,
        })
      }
    })

    const samples: BenchmarkSample[] = []

    await test.step('Measure drag latency', async () => {
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        const direction: 'down' | 'up' = iteration % 2 === 0 ? 'down' : 'up'
        const deltaY = direction === 'down' ? dragDistancePx : -dragDistancePx
        const marks = await runMeasuredDrag({
          page,
          targetHandleIndex,
          deltaY,
          steps: dragSteps,
        })
        samples.push(extractBenchmarkSample(marks, iteration, direction))
        await page.waitForTimeout(50)
      }
    })

    const report = {
      generatedAt: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      config: {
        lineCount,
        warmups,
        iterations,
        dragDistancePx,
        dragSteps,
        targetLineIndex,
        targetHandleIndex,
      },
      summary: {
        rust: summarizePhase(samples, 'rustMs'),
        scene: summarizePhase(samples, 'sceneMs'),
        apply: summarizePhase(samples, 'applyMs'),
        total: summarizePhase(samples, 'totalMs'),
      },
      samples,
    }

    const reportPath = testInfo.outputPath('sketch-solve-drag-benchmark.json')
    await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    await testInfo.attach('sketch-solve-drag-benchmark', {
      path: reportPath,
      contentType: 'application/json',
    })

    console.log(
      `Sketch solve drag benchmark summary: ${JSON.stringify(report.summary)}`
    )

    if (
      MAX_TOTAL_MEDIAN_MS !== undefined &&
      report.summary.total.medianMs > MAX_TOTAL_MEDIAN_MS
    ) {
      throw new Error(
        `Median total drag latency ${report.summary.total.medianMs}ms exceeded threshold ${MAX_TOTAL_MEDIAN_MS}ms.`
      )
    }
  })
})
