import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir, cpus, platform, arch, release } from 'node:os'
import path from 'node:path'
import { _electron, expect, test } from '@playwright/test'
import { interactions } from '@src/lib/interactionPerformance/definitions'
import { reportInteractions } from '@src/lib/interactionPerformance/report'
import type { ReductionCapture } from '@e2e/performance/palette-reduction/renderer'
import presentation from '@e2e/performance/palette-reduction/home-presentation.json'
import { readPaletteAppearance } from '@e2e/performance/palette-reduction/presentation'
import type { PaletteAppearance } from '@e2e/performance/palette-reduction/presentation'
import { startNativeGpuTrace } from '@e2e/performance/palette-reduction/native-gpu-trace'

const buildDirectory = path.resolve('test-results/palette-reduction-build')

test('first-use standalone palette presentation', async ({}, testInfo) => {
  const frameObserver = process.env.PALETTE_REDUCTION_FRAME_OBSERVER ?? 'true'
  expect(['true', 'false'], 'Unknown extra frame observer option').toContain(
    frameObserver
  )
  const extraFrameObserverEnabled = frameObserver === 'true'
  const nativeTraceEnabled =
    process.env.PALETTE_REDUCTION_NATIVE_TRACE === 'true'
  const tracesGpu = nativeTraceEnabled && testInfo.repeatEachIndex === 0
  if (tracesGpu) testInfo.setTimeout(120_000)
  let nativeTrace: Awaited<ReturnType<typeof startNativeGpuTrace>> | undefined
  const repetitions = Number(process.env.PALETTE_REDUCTION_REPEAT_EACH)
  expect(
    Number.isInteger(repetitions) && repetitions > 0,
    'The runner must provide the resolved repetition count'
  ).toBe(true)
  const finalRepeatIndex = repetitions - 1
  const validatesPresentation = testInfo.repeatEachIndex === finalRepeatIndex
  const profile = await mkdtemp(path.join(tmpdir(), 'palette-reduction-'))
  const electron = await _electron.launch({
    args: [path.join(buildDirectory, 'main.cjs'), '--no-sandbox'],
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      TMPDIR: process.env.TMPDIR ?? tmpdir(),
      NODE_ENV: 'production',
      PALETTE_REDUCTION_PROFILE: profile,
    },
    timeout: 20_000,
  })
  try {
    const page = await electron.firstWindow()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.evaluate(() => document.fonts.ready)
    const open = page.getByTestId(interactions.commandPaletteOpen.testId)
    const close = page.getByTestId(interactions.commandPaletteClose.testId)
    await expect(open).toBeEnabled()
    await expect(page.getByTestId('command-bar-wrapper')).toBeHidden()
    if (tracesGpu) nativeTrace = await startNativeGpuTrace(electron)
    const capture = await page.evaluateHandle(
      async (extraFrameObserverEnabled): Promise<ReductionCapture> => {
        const source = './renderer.js'
        const module: {
          createCapture(options: {
            extraFrameObserverEnabled: boolean
          }): ReductionCapture
        } = await import(source)
        return module.createCapture({ extraFrameObserverEnabled })
      },
      extraFrameObserverEnabled
    )
    try {
      await open.click()
      await expect
        .poll(
          async () =>
            capture.evaluate((state) =>
              state
                .snapshot()
                .samples.some(
                  (sample) =>
                    sample.id === 'zds.commandPalette.open' &&
                    sample.status === 'complete'
                )
            ),
          { intervals: [10], timeout: 10_000 }
        )
        .toBe(true)
      await expect(page.getByTestId('cmd-bar-search')).toBeEditable()
      await close.click()
      await expect
        .poll(
          async () =>
            capture.evaluate((state) =>
              state
                .snapshot()
                .samples.some(
                  (sample) =>
                    sample.id === 'zds.commandPalette.close' &&
                    sample.status === 'complete'
                )
            ),
          { intervals: [10], timeout: 10_000 }
        )
        .toBe(true)
      await expect(page.getByTestId('command-bar-wrapper')).toBeHidden()
    } finally {
      try {
        // Match the app's post-action Event Timing reporting window, without inputs.
        await page.evaluate(
          () => new Promise<void>((resolve) => setTimeout(resolve, 1000))
        )
        const evidence = await capture.evaluate((state) => state.stop())
        const runtime = await electron.evaluate(
          async ({ app }, profile) => ({
            electron: process.versions.electron,
            chrome: process.versions.chrome,
            gpu: await app.getGPUInfo('basic'),
            gpuFeatures: app.getGPUFeatureStatus(),
            profile: {
              userDataMatchesRequested: app.getPath('userData') === profile,
              sessionDataMatchesRequested:
                app.getPath('sessionData') === profile,
            },
          }),
          profile
        )
        const build: unknown = JSON.parse(
          await readFile(path.join(buildDirectory, 'metadata.json'), 'utf8')
        )
        const metadata = {
          calibrationEligible: false,
          extraFrameObserverEnabled,
          nativeTraceEnabled,
          nativeTraceRequestedForThisRepeat: tracesGpu,
          repeatIndex: testInfo.repeatEachIndex,
          presentationValidation: {
            finalRepeatIndex,
            deferred: !validatesPresentation,
          },
          runId: process.env.GITHUB_RUN_ID ?? null,
          runner: process.env.RUNNER_NAME ?? 'local',
          cpu: cpus()[0]?.model ?? null,
          platform: platform(),
          architecture: arch(),
          osRelease: release(),
          ...runtime,
          renderer: await page.evaluate(() => ({
            timeOrigin: performance.timeOrigin,
            devicePixelRatio,
            viewport: { width: innerWidth, height: innerHeight },
            visibility: document.visibilityState,
            focused: document.hasFocus(),
          })),
          build,
        }
        const report = reportInteractions(evidence.snapshot, {
          [interactions.commandPaletteOpen.id]: 1,
          [interactions.commandPaletteClose.id]: 1,
        })
        await testInfo.attach('palette-reduction-evidence', {
          body: JSON.stringify({ metadata, ...evidence, report }, null, 2),
          contentType: 'application/json',
        })
        if (validatesPresentation) {
          const fidelity: {
            validated: boolean
            expected: PaletteAppearance
            actual: PaletteAppearance | null
          } = {
            validated: false,
            expected: {
              geometry: presentation.geometry,
              styles: presentation.styles,
              optionCount: presentation.optionCount,
              autofocused: presentation.autofocused,
            },
            actual: null,
          }
          try {
            // Validate after the final scored pair, so this extra open cannot
            // warm host GPU caches before any later scored interaction.
            await open.click()
            await page.waitForFunction(() => {
              const wrapper = document.querySelector(
                '[data-testid="command-bar-wrapper"]'
              )
              return (
                wrapper?.checkVisibility({ checkOpacity: true }) &&
                wrapper.firstElementChild &&
                !wrapper.firstElementChild.classList.contains('duration-100') &&
                wrapper
                  .getAnimations({ subtree: true })
                  .every((animation) => animation.playState !== 'running')
              )
            })
            await page.mouse.move(0, 799)
            fidelity.actual = await page.evaluate(readPaletteAppearance)
            expect(
              fidelity.actual,
              'Presentation mismatch invalidates the reduction'
            ).toEqual(fidelity.expected)
            fidelity.validated = true
          } finally {
            await testInfo.attach('palette-reduction-fidelity', {
              body: JSON.stringify(fidelity, null, 2),
              contentType: 'application/json',
            })
          }
        } else {
          await testInfo.attach('palette-reduction-fidelity', {
            body: JSON.stringify({
              status: 'deferred-to-final-repeat',
              finalRepeatIndex,
            }),
            contentType: 'application/json',
          })
        }
        expect(
          runtime.profile,
          'The diagnostic requires the dedicated profile'
        ).toEqual({
          userDataMatchesRequested: true,
          sessionDataMatchesRequested: true,
        })
        expect(
          report.errors,
          'Invalid collection is not passing evidence'
        ).toEqual([])
        expect(
          report.violations,
          'Reduction interaction budget exceeded'
        ).toEqual([])
      } finally {
        await capture.dispose()
      }
    }
  } finally {
    try {
      await nativeTrace?.finish(testInfo)
    } finally {
      await electron.close()
    }
  }
})
