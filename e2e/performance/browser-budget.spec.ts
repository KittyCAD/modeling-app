import { expect, test } from '@playwright/test'
import { uiInteractions } from '@src/lib/interactionPerformance/uiOutcomes'
import { reportInteractions } from '@src/lib/interactionPerformance/report'
import type { InteractionReport } from '@src/lib/interactionPerformance/report'
import type { InteractionSnapshot } from '@src/lib/interactionPerformance/types'
import { ASK_TO_OPEN_QUERY_PARAM } from '@src/lib/constants'

test(
  uiInteractions.browserHandoffOpen.id,
  async ({ page, browser }, testInfo) => {
    const prefix = uiInteractions.browserHandoffOpen.id
    const controlTestId = uiInteractions.browserHandoffOpen.testId
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.addInitScript(
      ({ prefix, controlTestId }) => {
        let panel: Element | undefined
        let finished = false
        const cleanup = () => {
          document.removeEventListener('transitionstart', onStart, true)
          document.removeEventListener('transitionend', onEnd, true)
          document.removeEventListener('transitioncancel', onCancel, true)
          document.removeEventListener('visibilitychange', onVisibility)
          window.removeEventListener('pagehide', cleanup)
        }
        const onVisibility = () => {
          if (panel && document.visibilityState === 'hidden') {
            performance.mark(`${prefix}.hidden`)
          }
        }
        const onStart = (event: Event) => {
          if (
            panel ||
            !event.isTrusted ||
            !(event instanceof TransitionEvent) ||
            event.propertyName !== 'opacity' ||
            !(event.target instanceof Element) ||
            !event.target.querySelector(`[data-testid="${controlTestId}"]`)
          ) {
            return
          }
          panel = event.target
          const animation = panel
            .getAnimations()
            .find(
              (candidate) =>
                candidate instanceof CSSTransition &&
                candidate.transitionProperty === event.propertyName
            )
          const delay = animation?.effect?.getTiming().delay ?? 0
          performance.mark(`${prefix}.start`, {
            startTime:
              event.timeStamp - event.elapsedTime * 1000 - Math.max(0, delay),
          })
          requestAnimationFrame(() =>
            requestAnimationFrame(() => performance.mark(`${prefix}.render`))
          )
        }
        const finishAfterRender = () => {
          if (finished || !panel) return
          if (!panel.isConnected) {
            performance.mark(`${prefix}.cancelled`)
            finished = true
            cleanup()
            return
          }
          const style = getComputedStyle(panel)
          if (
            Number(style.opacity) !== 1 ||
            (style.transform !== 'none' &&
              !new DOMMatrixReadOnly(style.transform).isIdentity) ||
            panel
              .getAnimations()
              .some((animation) => animation.playState === 'running')
          ) {
            requestAnimationFrame(finishAfterRender)
            return
          }
          performance.mark(`${prefix}.complete`)
          performance.measure(prefix, `${prefix}.start`, `${prefix}.complete`)
          finished = true
          cleanup()
        }
        const onEnd = (event: Event) => {
          if (
            event.isTrusted &&
            event instanceof TransitionEvent &&
            event.propertyName === 'opacity' &&
            event.target === panel
          ) {
            performance.mark(`${prefix}.transitionEnd`, {
              startTime: event.timeStamp,
            })
            requestAnimationFrame(() =>
              requestAnimationFrame(finishAfterRender)
            )
          }
        }
        const onCancel = (event: Event) => {
          if (
            event.isTrusted &&
            event instanceof TransitionEvent &&
            event.propertyName === 'opacity' &&
            event.target === panel
          ) {
            performance.mark(`${prefix}.cancelled`)
            finished = true
            cleanup()
          }
        }
        document.addEventListener('transitionstart', onStart, true)
        document.addEventListener('transitionend', onEnd, true)
        document.addEventListener('transitioncancel', onCancel, true)
        document.addEventListener('visibilitychange', onVisibility)
        window.addEventListener('pagehide', cleanup, { once: true })
      },
      { prefix, controlTestId }
    )

    let report: InteractionReport | undefined
    try {
      await page.goto(`/?${ASK_TO_OPEN_QUERY_PARAM}=true`)
      await expect(page.getByTestId(controlTestId)).toBeVisible()
      await page.waitForFunction(
        (prefix) =>
          performance.getEntriesByName(prefix, 'measure').length > 0 ||
          performance.getEntriesByName(`${prefix}.cancelled`, 'mark').length >
            0,
        prefix,
        { timeout: 10_000 }
      )
    } finally {
      const evidence = await page.evaluate((prefix) => {
        const entries = performance
          .getEntries()
          .filter((entry) => entry.name.startsWith(prefix))
        const start = entries.find((entry) => entry.name === `${prefix}.start`)
        const render = entries.find(
          (entry) => entry.name === `${prefix}.render`
        )
        const measurement = entries.find(
          (entry) => entry.name === prefix && entry.entryType === 'measure'
        )
        return {
          startTime: start?.startTime ?? null,
          renderTime: render?.startTime ?? null,
          outcomeMs: measurement?.duration ?? null,
          visibilityInterrupted: entries.some(
            (entry) => entry.name === `${prefix}.hidden`
          ),
          entries: entries.map((entry) => ({
            name: entry.name,
            entryType: entry.entryType,
            startTime: entry.startTime,
            duration: entry.duration,
          })),
          userAgent: navigator.userAgent,
        }
      }, prefix)
      const snapshot: InteractionSnapshot = {
        registered: [uiInteractions.browserHandoffOpen],
        samples:
          evidence.startTime === null
            ? []
            : [
                {
                  sequence: 1,
                  id: prefix,
                  targetTag: 'div',
                  inputType: 'transitionstart',
                  startTime: evidence.startTime,
                  renderOpportunityMs:
                    evidence.renderTime === null
                      ? null
                      : evidence.renderTime - evidence.startTime,
                  outcomeMs: evidence.outcomeMs,
                  eventTiming: null,
                  status: evidence.outcomeMs === null ? 'timeout' : 'complete',
                },
              ],
        droppedSamples: 0,
        droppedPointerEvents: 0,
        visibilityInterrupted: evidence.visibilityInterrupted,
      }
      report = reportInteractions(snapshot, { [prefix]: 1 })
      await testInfo.attach('interaction-measurements', {
        body: JSON.stringify(
          {
            metadata: {
              scenario: `budget.${prefix}`,
              timing: 'native-transition-start-to-settled-after-render',
              excludes: 'page loading, authentication, and API response time',
              browser: browser.version(),
              viewport: page.viewportSize(),
              motion: 'no-preference',
            },
            evidence,
            snapshot,
            report,
          },
          null,
          2
        ),
        contentType: 'application/json',
      })
    }
    if (!report)
      throw new Error('Browser interaction collection produced no report')
    expect(
      report.errors,
      'Invalid collection is not a budget baseline'
    ).toEqual([])
    expect(report.violations, 'Interaction latency budget exceeded').toEqual([])
  }
)
