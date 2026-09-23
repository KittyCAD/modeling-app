import type { JSHandle, Page, TestInfo } from '@playwright/test'
import { interactions } from '@src/lib/interactionPerformance/definitions'
import type { InteractionSample } from '@src/lib/interactionPerformance/types'

interface AnimationTarget {
  tagName: string
  id: string | null
  testId: string | null
  className: string | null
}

interface AnimationState {
  sequence: number
  target: AnimationTarget | null
  transitionProperty: string | null
  animationName: string | null
  startTime: number | string | null
  currentTime: number | string | null
  pending: boolean
  playState: AnimationPlayState
  timing: {
    duration: number | string | null
    delay: number | null
    progress: number | null
  } | null
  style: {
    transitionDuration: string
    transitionDelay: string
    animationDuration: string
    animationDelay: string
  } | null
}

interface AnimationEvidence {
  metadata: {
    calibrationEligible: false
    instrumentation: string
    timeOrigin: number
    maximumDurationMs: number
  }
  startedAt: number
  stoppedAt: number | null
  stopReason: 'finished' | 'duration-limit' | 'error' | null
  frames: {
    observedAt: number
    wrapperPresent: boolean
    animations: AnimationState[]
    latestOpenSample: InteractionSample | null
  }[]
  events: {
    observedAt: number
    timeStamp: number
    type: string
    target: AnimationTarget
    propertyName: string
    elapsedTime: number
    pseudoElement: string
  }[]
  errors: string[]
}

interface AnimationWitness {
  stop(): AnimationEvidence
}

const witnesses = new WeakMap<Page, JSHandle<AnimationWitness>>()
const MAXIMUM_DURATION_MS = 30_000

export async function startAnimationWitness(page: Page) {
  if (witnesses.has(page)) {
    throw new Error('An animation witness is already active for this page.')
  }
  const witness = await page.evaluateHandle(
    ({ maximumDurationMs, openId }) => {
      const evidence: AnimationEvidence = {
        metadata: {
          calibrationEligible: false,
          instrumentation:
            'Scoped transition events and animation-frame animation/style reads; diagnostic timings include observer overhead.',
          timeOrigin: performance.timeOrigin,
          maximumDurationMs,
        },
        startedAt: performance.now(),
        stoppedAt: null,
        stopReason: null,
        frames: [],
        events: [],
        errors: [],
      }
      const selector = '[data-testid="command-bar-wrapper"]'
      const eventTypes = [
        'transitionrun',
        'transitionstart',
        'transitionend',
        'transitioncancel',
      ]
      const animationSequences = new WeakMap<Animation, number>()
      let nextSequence = 1
      let frameId: number | undefined
      let timeoutId: number | undefined

      function targetAttributes(target: Element): AnimationTarget {
        return {
          tagName: target.tagName,
          id: target.getAttribute('id'),
          testId: target.getAttribute('data-testid'),
          className: target.getAttribute('class'),
        }
      }

      function animationTime(value: CSSNumberish | string | null | undefined) {
        return typeof value === 'number' ? value : (value?.toString() ?? null)
      }

      function onTransition(event: Event) {
        if (
          !(event instanceof TransitionEvent) ||
          !(event.target instanceof Element) ||
          !event.target.closest(selector)
        ) {
          return
        }
        evidence.events.push({
          observedAt: performance.now(),
          timeStamp: event.timeStamp,
          type: event.type,
          target: targetAttributes(event.target),
          propertyName: event.propertyName,
          elapsedTime: event.elapsedTime,
          pseudoElement: event.pseudoElement,
        })
      }

      function stop(reason: NonNullable<AnimationEvidence['stopReason']>) {
        if (evidence.stoppedAt !== null) return evidence
        evidence.stoppedAt = performance.now()
        evidence.stopReason = reason
        for (const type of eventTypes) {
          document.removeEventListener(type, onTransition, true)
        }
        if (frameId !== undefined) cancelAnimationFrame(frameId)
        if (timeoutId !== undefined) clearTimeout(timeoutId)
        return evidence
      }

      function snapshot() {
        if (evidence.stoppedAt !== null) return
        try {
          const observedAt = performance.now()
          if (observedAt - evidence.startedAt >= maximumDurationMs) {
            stop('duration-limit')
            return
          }
          const wrapper = document.querySelector(selector)
          const animations: AnimationState[] = (
            wrapper?.getAnimations({ subtree: true }) ?? []
          ).map((animation) => {
            let sequence = animationSequences.get(animation)
            if (sequence === undefined) {
              sequence = nextSequence++
              animationSequences.set(animation, sequence)
            }
            const target =
              animation.effect instanceof KeyframeEffect
                ? animation.effect.target
                : null
            const timing = animation.effect?.getComputedTiming()
            const style = target ? getComputedStyle(target) : null
            return {
              sequence,
              target: target ? targetAttributes(target) : null,
              transitionProperty:
                animation instanceof CSSTransition
                  ? animation.transitionProperty
                  : null,
              animationName:
                animation instanceof CSSAnimation
                  ? animation.animationName
                  : null,
              startTime: animationTime(animation.startTime),
              currentTime: animationTime(animation.currentTime),
              pending: animation.pending,
              playState: animation.playState,
              timing: timing
                ? {
                    duration: animationTime(timing.duration),
                    delay: timing.delay ?? null,
                    progress: timing.progress ?? null,
                  }
                : null,
              style: style
                ? {
                    transitionDuration: style.transitionDuration,
                    transitionDelay: style.transitionDelay,
                    animationDuration: style.animationDuration,
                    animationDelay: style.animationDelay,
                  }
                : null,
            }
          })
          evidence.frames.push({
            observedAt,
            wrapperPresent: wrapper !== null,
            animations,
            latestOpenSample:
              window.app.interactionPerformance
                ?.snapshot()
                .samples.findLast((sample) => sample.id === openId) ?? null,
          })
          frameId = requestAnimationFrame(snapshot)
        } catch (error) {
          evidence.errors.push(
            error instanceof Error ? error.message : String(error)
          )
          stop('error')
        }
      }

      // The handle owns cleanup; the timer also bounds a hidden or abandoned page.
      for (const type of eventTypes) {
        document.addEventListener(type, onTransition, true)
      }
      timeoutId = window.setTimeout(
        () => stop('duration-limit'),
        maximumDurationMs
      )
      snapshot()
      return { stop: () => stop('finished') }
    },
    {
      maximumDurationMs: MAXIMUM_DURATION_MS,
      openId: interactions.commandPaletteOpen.id,
    }
  )
  witnesses.set(page, witness)
}

export async function finishAnimationWitness(page: Page, testInfo?: TestInfo) {
  const witness = witnesses.get(page)
  if (!witness) return
  witnesses.delete(page)
  try {
    const evidence = await witness.evaluate((state) => state.stop())
    await testInfo?.attach('animation-witness', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    })
  } finally {
    await witness.dispose()
  }
}
