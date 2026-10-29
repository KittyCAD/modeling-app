import { expect, test } from '@playwright/test'
import { expectAbsoluteInteractionBudget } from '@e2e/performance/absolute-budget'
import { reportInteractions } from '@src/lib/interactionPerformance/report'
import type { InteractionSnapshot } from '@src/lib/interactionPerformance/types'
import { ASK_TO_OPEN_QUERY_PARAM } from '@src/lib/constants'

const handoff = {
  id: 'zds.browserHandoff.show',
  testId: 'continue-to-web-app-button',
  budgetMs: 150,
  outcome: 'The browser desktop-handoff screen and its choices are usable',
}

test(handoff.id, async ({ page, browser }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.addInitScript(
    ({ id, testId }) => {
      let frame: number | undefined
      let task: number | undefined
      let finished = false
      let interrupted = document.visibilityState !== 'visible'
      const cleanup = () => {
        if (frame !== undefined) cancelAnimationFrame(frame)
        if (task !== undefined) clearTimeout(task)
        document.removeEventListener('visibilitychange', onVisibility)
        window.removeEventListener('pagehide', cleanup)
      }
      const onVisibility = () => {
        interrupted ||= document.visibilityState !== 'visible'
      }
      const ready = () => {
        const button = document.querySelector(`[data-testid="${testId}"]`)
        const panel = button?.closest('.max-w-3xl')
        if (!(button instanceof HTMLButtonElement) || !panel) return false
        const style = getComputedStyle(panel)
        return (
          document.fonts.status === 'loaded' &&
          !button.disabled &&
          button.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
          }) &&
          Number(style.opacity) === 1 &&
          (style.transform === 'none' ||
            new DOMMatrixReadOnly(style.transform).isIdentity) &&
          Array.from(panel.querySelectorAll('button, a')).every((choice) =>
            choice.checkVisibility({
              checkOpacity: true,
              checkVisibilityCSS: true,
            })
          ) &&
          panel
            .getAnimations({ subtree: true })
            .every(
              (animation) =>
                animation.effect?.getComputedTiming().endTime === Infinity ||
                animation.playState === 'finished' ||
                animation.playState === 'idle'
            )
        )
      }
      const observe = () => {
        frame = requestAnimationFrame(() => {
          frame = undefined
          if (!ready()) {
            observe()
            return
          }
          task = window.setTimeout(() => {
            task = undefined
            if (!ready()) {
              observe()
              return
            }
            if (finished) return
            finished = true
            performance.mark(`${id}.ready`)
            if (interrupted) performance.mark(`${id}.hidden`)
            // Showing this screen is a navigation, not a button click or an
            // animation phase. Include document startup through the usable view.
            performance.measure(id, { start: 0, end: `${id}.ready` })
            cleanup()
          }, 0)
        })
      }
      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('pagehide', cleanup, { once: true })
      observe()
    },
    { id: handoff.id, testId: handoff.testId }
  )

  let collectionError: Error | undefined
  try {
    await page.goto(`/?${ASK_TO_OPEN_QUERY_PARAM}=true`)
    await expect(page.getByTestId(handoff.testId)).toBeEnabled()
    await page.waitForFunction(
      (id) => performance.getEntriesByName(id, 'measure').length === 1,
      handoff.id
    )
  } catch (error) {
    collectionError = error instanceof Error ? error : new Error(String(error))
  }
  const evidence = await page.evaluate((id) => {
    const measurement = performance.getEntriesByName(id, 'measure')[0]
    return {
      outcomeMs: measurement?.duration ?? null,
      visibilityInterrupted:
        performance.getEntriesByName(`${id}.hidden`, 'mark').length > 0,
    }
  }, handoff.id)
  const snapshot: InteractionSnapshot = {
    registered: [handoff],
    samples: [
      {
        sequence: 1,
        id: handoff.id,
        targetTag: 'document',
        startTime: 0,
        renderOpportunityMs: evidence.outcomeMs,
        outcomeMs: evidence.outcomeMs,
        eventTiming: null,
        status: evidence.outcomeMs === null ? 'timeout' : 'complete',
      },
    ],
    droppedSamples: 0,
    droppedPointerEvents: 0,
    visibilityInterrupted: evidence.visibilityInterrupted,
  }
  const report = reportInteractions(snapshot, { [handoff.id]: 1 })
  await testInfo.attach('interaction-measurements', {
    body: JSON.stringify(
      {
        metadata: {
          scenario: handoff.id,
          timing: 'navigation-start-to-usable-handoff-after-render',
          browser: browser.version(),
          viewport: page.viewportSize(),
          motion: 'no-preference',
        },
        snapshot,
        report,
      },
      null,
      2
    ),
    contentType: 'application/json',
  })
  if (collectionError) throw collectionError
  await expectAbsoluteInteractionBudget(report, undefined, testInfo)
})
