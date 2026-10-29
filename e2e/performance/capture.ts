import { arch, cpus, platform, release, totalmem } from 'node:os'
import type { ElectronZoo } from '@e2e/playwright/fixtures/fixtureSetup'
import type { Page, TestInfo } from '@playwright/test'
import { expect } from '@playwright/test'
import { reportInteractions } from '@src/lib/interactionPerformance/report'
import type { InteractionReport } from '@src/lib/interactionPerformance/report'
import type { ComparisonSessionIdentity } from '@e2e/performance/comparison'
import type { PerformanceModelProfile } from '@e2e/performance/models'

const POLL_INTERVAL_MS = 10
const EVENT_TIMING_REPORTING_WINDOW_MS = 1000

export async function startCapture(
  page: Page,
  interactionIds?: readonly string[]
) {
  await page.evaluate((ids) => {
    const recorder = window.app.interactionPerformance
    if (!recorder) {
      throw new Error('Build the app with VITE_INTERACTION_PERFORMANCE=1.')
    }
    return recorder.start(ids)
  }, interactionIds)
}

export function readCapture() {
  const recorder = window.app.interactionPerformance
  if (!recorder) {
    throw new Error('Build the app with VITE_INTERACTION_PERFORMANCE=1.')
  }
  return recorder.snapshot()
}

export async function waitForSample(
  page: Page,
  id: string,
  count: number,
  timeoutMs = 35_000
) {
  await page.waitForFunction(
    ({ id, count }) =>
      window.app.interactionPerformance
        ?.snapshot()
        .samples.filter(
          (sample) => sample.id === id && sample.status === 'complete'
        ).length === count,
    { id, count },
    { timeout: timeoutMs, polling: POLL_INTERVAL_MS }
  )
}

export async function attachOutcomeDiagnostics(
  page: Page,
  testInfo: TestInfo,
  reason: string
) {
  const evidence = await page.evaluate(() => {
    const describe = (element: Element | null) => {
      if (!element) return null
      const style = getComputedStyle(element)
      const bounds = element.getBoundingClientRect()
      return {
        tag: element.localName,
        id: element.id,
        testId: element.getAttribute('data-testid'),
        classes: element.classList.value,
        visible: element.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
        }),
        opacity: style.opacity,
        transform: style.transform,
        identityTransform:
          style.transform === 'none' ||
          new DOMMatrixReadOnly(style.transform).isIdentity,
        display: style.display,
        visibility: style.visibility,
        transitionProperty: style.transitionProperty,
        transitionDuration: style.transitionDuration,
        transitionDelay: style.transitionDelay,
        width: bounds.width,
        height: bounds.height,
        animations: element
          .getAnimations({ subtree: true })
          .map((animation) => {
            const effect = animation.effect
            const computed = effect?.getComputedTiming()
            const target =
              effect instanceof KeyframeEffect ? effect.target : null
            return {
              kind: animation.constructor.name,
              name:
                animation instanceof CSSAnimation
                  ? animation.animationName
                  : null,
              property:
                animation instanceof CSSTransition
                  ? animation.transitionProperty
                  : null,
              state: animation.playState,
              currentTime:
                typeof animation.currentTime === 'number'
                  ? animation.currentTime
                  : null,
              endTime:
                computed?.endTime === Infinity ? 'Infinity' : computed?.endTime,
              delay: effect?.getTiming().delay,
              targetId: target instanceof Element ? target.id : null,
              targetTestId:
                target instanceof Element
                  ? target.getAttribute('data-testid')
                  : null,
            }
          }),
      }
    }
    const editor = window.app.project?.executingEditor.value
    const controls = editor?.sceneInfra.camControls
    const videoElement = document.getElementById('video-stream')
    const video = videoElement instanceof HTMLVideoElement ? videoElement : null
    const playbackQuality = video?.getVideoPlaybackQuality()
    const analysisPanel = document.querySelector(
      '[data-testid="physical-analysis-draggable-panel"]'
    )
    const densityInput = analysisPanel?.querySelector(
      '[data-testid="physical-analysis-density"]'
    )
    const pending = Object.entries(
      editor?.engineCommandManager.pendingCommands ?? {}
    )
    return {
      url: location.href,
      visibility: document.visibilityState,
      settingsState: window.app.settings.actor.getSnapshot().value,
      headings: Array.from(document.querySelectorAll('h1')).map(
        (heading) => heading.textContent
      ),
      dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).map(
        (dialog) => ({
          owner: describe(dialog),
          panel: describe(
            dialog.querySelector('[id^="headlessui-dialog-panel-"]')
          ),
          backdrop: describe(
            dialog.querySelector('[aria-hidden="true"].fixed.inset-0')
          ),
        })
      ),
      physicalAnalysis: analysisPanel
        ? {
            panel: describe(analysisPanel),
            text:
              analysisPanel instanceof HTMLElement
                ? analysisPanel.innerText.slice(0, 6000)
                : null,
            density:
              densityInput instanceof HTMLInputElement
                ? densityInput.value
                : null,
          }
        : null,
      video: video
        ? {
            streamId:
              video.srcObject instanceof MediaStream
                ? video.srcObject.id
                : null,
            loaded: video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
            readyState: video.readyState,
            visible: video.checkVisibility({
              checkOpacity: true,
              checkVisibilityCSS: true,
            }),
            paused: video.paused,
            ended: video.ended,
            currentTime: video.currentTime,
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            playbackQuality: playbackQuality
              ? {
                  creationTime: playbackQuality.creationTime,
                  totalVideoFrames: playbackQuality.totalVideoFrames,
                  droppedVideoFrames: playbackQuality.droppedVideoFrames,
                }
              : null,
          }
        : null,
      camera: controls
        ? {
            position: controls.camera.position.toArray(),
            target: controls.target.toArray(),
            quaternion: controls.camera.quaternion.toArray(),
            direction: controls.camera.position
              .clone()
              .sub(controls.target)
              .normalize()
              .toArray(),
            quaternionDirection: controls.camera.position
              .clone()
              .set(0, 0, 1)
              .applyQuaternion(controls.camera.quaternion)
              .toArray(),
            syncDirection: controls.syncDirection,
            enableRotate: controls.enableRotate,
            enablePan: controls.enablePan,
            isPerspective: controls.isPerspective,
            isFovAnimationInProgress: controls.isFovAnimationInProgress,
          }
        : null,
      editor: editor
        ? {
            isExecuting: editor.isExecutingSignal.value,
            hasErrors: editor.hasErrors(),
            hasParseErrors: editor.hasParseErrors(),
            diagnostics: editor.diagnostics.map(
              ({ severity, from, to, message }) => ({
                severity,
                from,
                to,
                message,
              })
            ),
            hasEditsSinceLastExecution:
              editor.hasEditsSinceLastExecutionSignal.value,
            lastSuccessfulCodeMatchesCurrent:
              editor.lastSuccessfulCode === editor.code,
            artifactCount: editor.artifactGraph.size,
            pendingCommandCount: pending.length,
            pendingCommands: pending.slice(-20).map(([id, request]) => ({
              id,
              type:
                request.command.type === 'modeling_cmd_req'
                  ? request.command.cmd.type
                  : request.command.type,
              isSceneCommand: request.isSceneCommand,
            })),
            errorCount: editor.errors.length,
            errors: editor.errors.map(({ kind, msg, sourceRange }) => ({
              kind,
              msg,
              sourceRange,
            })),
            importedModuleCount: Object.keys(editor.execState.filenames).length,
            largeProfile: editor.code.includes('import "large-model/main.kcl"'),
          }
        : null,
    }
  })
  await testInfo.attach('interaction-outcome-diagnostics', {
    body: JSON.stringify({ reason, evidence }, null, 2),
    contentType: 'application/json',
  })
}

export async function finishCapture(
  page: Page,
  testInfo: TestInfo,
  scenario: string,
  expected: Readonly<Record<string, number>>,
  tronApp: ElectronZoo | undefined,
  comparison?: Readonly<ComparisonSessionIdentity>,
  modelProfile?: PerformanceModelProfile
): Promise<InteractionReport> {
  const snapshot = await page.evaluate(async (reportingWindowMs) => {
    const recorder = window.app.interactionPerformance
    if (!recorder) {
      throw new Error('Build the app with VITE_INTERACTION_PERFORMANCE=1.')
    }
    // GPU presentation feedback can arrive after the final DOM outcome. Keep
    // collecting without changing completed durations or exercising more inputs.
    await new Promise((resolve) => setTimeout(resolve, reportingWindowMs))
    return recorder.stop()
  }, EVENT_TIMING_REPORTING_WINDOW_MS)
  const report = reportInteractions(snapshot, expected)
  if (!tronApp) throw new Error('Interaction measurements require Electron.')
  const runtime = await tronApp.electron.evaluate(async ({ app }) => ({
    browser: process.versions.chrome,
    electron: process.versions.electron,
    gpu: await app.getGPUInfo('basic'),
    gpuFeatures: app.getGPUFeatureStatus(),
  }))
  const metadata = {
    scenario,
    comparison,
    modelProfile,
    calibrationFault: process.env.INTERACTION_CALIBRATION_FAULT ?? 'none',
    repeatIndex: testInfo.repeatEachIndex,
    commit: process.env.GITHUB_SHA ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    runner: process.env.RUNNER_NAME ?? 'local',
    platform: platform(),
    architecture: arch(),
    osRelease: release(),
    cpu: cpus()[0]?.model ?? null,
    logicalCpus: cpus().length,
    memoryBytes: totalmem(),
    node: process.version,
    ...runtime,
    viewport: await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    })),
    configuredViewport: page.viewportSize(),
    motion: 'no-preference',
    timing: 'native-user-input-to-usable-outcome-observed-after-render',
    eventTimingReportingWindowMs: EVENT_TIMING_REPORTING_WINDOW_MS,
  }
  // Preserve raw records before assertions so a failed collection is inspectable.
  await testInfo.attach('interaction-measurements', {
    body: JSON.stringify({ metadata, snapshot, report }, null, 2),
    contentType: 'application/json',
  })
  if (report.errors.length > 0) {
    await attachOutcomeDiagnostics(page, testInfo, report.errors.join('\n'))
  }
  const duration = (value: number | null) =>
    value === null ? 'unreported' : `${value.toFixed(1)} ms`
  await testInfo.attach('interaction-summary', {
    body: [
      `Scenario: ${scenario}`,
      `Collection errors: ${report.errors.length}`,
      `Observed budget breaches: ${report.violations.length}`,
      `Unattributed clicks: ${report.unattributed}`,
      ...report.coverage.map(
        (row) =>
          `${row.id}: expectation under ${row.budgetMs} ms, measured ${row.measured}/${row.expected ?? 'not scheduled'}, outcome maximum ${duration(row.maximumMs)}, p50 ${duration(row.p50Ms)}, p95 ${duration(row.p95Ms)}, Event Timing reported ${row.eventTimingMeasured}/${row.exercised}, responsiveness maximum ${duration(row.responsivenessMaximumMs)}`
      ),
      ...report.errors,
    ].join('\n'),
    contentType: 'text/plain',
  })
  return report
}

export function expectInteractionBudget(report: InteractionReport) {
  expect(
    report.errors,
    'Invalid collection is not a passing measurement'
  ).toEqual([])
  expect(report.violations, 'Interaction latency budget exceeded').toEqual([])
}
