import {
  attachGuiFuzzRuntimeEvents,
  captureGuiFuzzStep,
  GUI_FUZZ_VIEWPORT,
  installGuiFuzzPointerOverlay,
  observeGuiFuzzRuntime,
  prepareGuiFuzzProject,
  waitForGuiFuzzSketchReady,
} from '@e2e/playwright/guiFuzzUtils'
import { expect, test } from '@e2e/playwright/zoo-test'
import type { Page, TestInfo } from '@playwright/test'
import {
  EXPERIMENTAL_POINT_AND_CLICK_FLAG,
  SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
} from '@src/lib/constants'

const REWRITTEN_EMPTY_CODE =
  '@settings(kclVersion = 2.0, defaultLengthUnit = mm)\n'

type RaceProbeEvent = {
  at: number
  code: string
  event: string
  detail?: unknown
}

async function installEditorSketchRaceProbe(page: Page) {
  await page.evaluate(() => {
    const probeWindow = window as typeof window & {
      __zdsEditorSketchRaceProbe?: RaceProbeEvent[]
    }
    const kclManager = window.app.singletons.kclManager
    const rustContext = window.rustContext
    const events: RaceProbeEvent[] = []
    probeWindow.__zdsEditorSketchRaceProbe = events

    const record = (event: string, detail?: unknown) => {
      events.push({
        at: performance.now(),
        code: kclManager.code,
        event,
        detail,
      })
    }
    const wrapAsyncMethod = (
      target: Record<string, unknown>,
      method: string,
      summarizeArgs?: (args: unknown[]) => unknown,
      summarizeResult?: (result: unknown) => unknown
    ) => {
      const original = target[method]
      if (typeof original !== 'function') {
        return
      }

      target[method] = async (...args: unknown[]) => {
        record(`${method}:begin`, summarizeArgs?.(args))
        try {
          const result = await original.apply(target, args)
          record(`${method}:end`, summarizeResult?.(result))
          return result
        } catch (error) {
          record(`${method}:error`, String(error))
          throw error
        }
      }
    }

    wrapAsyncMethod(
      kclManager as unknown as Record<string, unknown>,
      'executeCode',
      (args) => ({ requestedCode: args[0] })
    )
    wrapAsyncMethod(
      rustContext as unknown as Record<string, unknown>,
      'execute'
    )
    wrapAsyncMethod(
      rustContext as unknown as Record<string, unknown>,
      'hackSetProgram',
      undefined,
      (result) => {
        const outcome = result as {
          type?: string
          sceneGraph?: { objects?: unknown[] }
        }
        return {
          objectCount: outcome.sceneGraph?.objects?.length,
          type: outcome.type,
        }
      }
    )
    wrapAsyncMethod(
      rustContext as unknown as Record<string, unknown>,
      'newSketch',
      (args) => ({ sketchArgs: args[3] }),
      (result) => {
        const outcome = result as {
          kclSource?: { text?: string }
          sceneGraphDelta?: { new_graph?: { objects?: unknown[] } }
          sketchId?: number
        }
        return {
          code: outcome.kclSource?.text,
          objectCount: outcome.sceneGraphDelta?.new_graph?.objects?.length,
          sketchId: outcome.sketchId,
        }
      }
    )
    wrapAsyncMethod(
      rustContext as unknown as Record<string, unknown>,
      'addSegment',
      (args) => ({ sketchId: args[1], segment: args[2] })
    )
  })
}

async function attachEditorSketchRaceProbe(page: Page, testInfo: TestInfo) {
  const events = await page.evaluate(() => {
    const probeWindow = window as typeof window & {
      __zdsEditorSketchRaceProbe?: RaceProbeEvent[]
    }
    return probeWindow.__zdsEditorSketchRaceProbe ?? []
  })
  await testInfo.attach('editor-sketch-race-probe.json', {
    body: JSON.stringify(events, null, 2),
    contentType: 'application/json',
  })
}

test.describe(
  'GUI fuzz regression: editor-to-sketch synchronization',
  { tag: ['@web', '@gui-fuzz'] },
  () => {
    test.use({
      userFeatures: [
        EXPERIMENTAL_POINT_AND_CLICK_FLAG,
        SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
      ],
    })

    test('a valid empty editor rewrite preserves point-and-click sketch state', async ({
      editor,
      page,
      scene,
      toolbar,
    }, testInfo) => {
      const runtimeEvents = observeGuiFuzzRuntime(page)
      const captureVideo = process.env.PLAYWRIGHT_GUI_FUZZ_VIDEO === '1'
      const annotateVideo =
        captureVideo && process.env.PLAYWRIGHT_GUI_FUZZ_VIDEO_ANNOTATE === '1'
      const paceVideo =
        captureVideo && process.env.PLAYWRIGHT_GUI_FUZZ_VIDEO_PACED === '1'
      const pauseForVideo = async (milliseconds = 1_200) => {
        if (paceVideo) {
          await page.waitForTimeout(milliseconds)
        }
      }
      const [clickFirstCorner] = scene.makeMouseHelpers(0.38, 0.4, {
        format: 'ratio',
        debugLabel: paceVideo ? 'First corner' : undefined,
      })
      const [clickSecondCorner] = scene.makeMouseHelpers(0.62, 0.6, {
        format: 'ratio',
        debugLabel: paceVideo ? 'Second corner' : undefined,
      })

      try {
        await page.setViewportSize(GUI_FUZZ_VIEWPORT)
        if (annotateVideo) {
          await installGuiFuzzPointerOverlay(page)
        }
        await prepareGuiFuzzProject(page, editor)
        await scene.connectionEstablished()
        await scene.settled()
        await installEditorSketchRaceProbe(page)
        await captureGuiFuzzStep(page, testInfo, 0, 'fresh-project')
        await pauseForVideo()

        await test.step('Rewrite the empty settings-only program', async () => {
          await editor.replaceCode('', REWRITTEN_EMPTY_CODE)
          await editor.expectEditor.toContain('defaultLengthUnit = mm')
          await scene.settled()
          await captureGuiFuzzStep(page, testInfo, 1, 'settings-rewritten')
          await pauseForVideo()
        })

        await test.step('Start a Top-plane sketch after the rewrite', async () => {
          await toolbar.startSketchOnDefaultPlane('Top plane')
          await waitForGuiFuzzSketchReady(page, editor, toolbar)
          await captureGuiFuzzStep(page, testInfo, 2, 'sketch-ready')
          await pauseForVideo()
        })

        await test.step('Draw a rectangle after the editor execution', async () => {
          await toolbar.rectangleBtn.click()
          await expect(toolbar.rectangleBtn).toHaveAttribute(
            'aria-pressed',
            'true'
          )
          await pauseForVideo(700)
          await clickFirstCorner()
          await pauseForVideo(900)
          await clickSecondCorner()
          await pauseForVideo(350)
          await captureGuiFuzzStep(page, testInfo, 3, 'rectangle-attempted')
          await pauseForVideo(1_500)
          await editor.expectEditor.toContain(/(rectangle|line|angledLine)/)
        })
      } finally {
        await attachEditorSketchRaceProbe(page, testInfo)
        await attachGuiFuzzRuntimeEvents(testInfo, runtimeEvents)
      }
    })
  }
)
