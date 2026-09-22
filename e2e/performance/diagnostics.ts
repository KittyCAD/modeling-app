import type { Page, TestInfo } from '@playwright/test'

// Temporary diagnosis only: style/animation reads add overhead to these runs.
export async function startInteractionDiagnostics(page: Page) {
  return page.evaluateHandle(() => {
    const timeOrigin = performance.timeOrigin
    const startedAt = performance.now()
    const maxRecords = 600
    const durationLimitMs = 20_000
    const inputs: {
      name: string
      timeStamp: number
      observedAt: number
      pointerId: number | null
      annotationId: string | null
    }[] = []
    const eventTiming: {
      name: string
      startTime: number
      processingStart: number
      processingEnd: number
      duration: number
      interactionId: number
      observedAt: number
    }[] = []
    const transitions: {
      name: string
      timeStamp: number
      observedAt: number
      target: string
      property: string
      elapsedTime: number
    }[] = []
    const selectors = {
      palette: '[data-testid="command-bar-wrapper"]',
      code: '#code-pane',
      files: '#files-pane',
    }
    const dropped = { inputs: 0, eventTiming: 0, transitions: 0, animations: 0 }
    let stoppedAt: number | null = null
    let stoppedBy: 'explicit' | 'time-limit' | 'frame-limit' | null = null
    let frame: number | undefined
    let deadline: number | undefined

    function targetName(element: Element | null): string {
      if (!element) return 'none'
      const palette = document.querySelector(selectors.palette)
      const panel = palette?.querySelector('[data-testid="command-bar"]')
      if (element === palette) return 'palette-wrapper'
      if (element === panel?.parentElement) return 'palette-transition'
      if (element === panel) return 'palette-panel'
      if (palette?.contains(element)) {
        return element.closest('[role="tooltip"]')
          ? 'palette-tooltip'
          : `palette-${element.tagName.toLowerCase()}`
      }
      if (element.closest(selectors.code))
        return `code-${element.tagName.toLowerCase()}`
      if (element.closest(selectors.files))
        return `files-${element.tagName.toLowerCase()}`
      return 'other'
    }

    function visible(element: Element | null | undefined) {
      return (
        element?.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
        }) ?? false
      )
    }

    function readPanels() {
      return Object.entries(selectors).map(([name, selector]) => {
        const panel = document.querySelector(selector)
        const input = panel?.querySelector('input[role="combobox"]')
        const code = panel?.querySelector('.cm-content')
        const files = panel?.querySelector(
          '[data-testid="file-pane-scroll-container"]'
        )
        const file = files?.querySelector(
          '[role="treeitem"][aria-disabled="false"]'
        )
        const transition =
          name === 'palette'
            ? panel?.querySelector('[data-testid="command-bar"]')?.parentElement
            : panel
        const style = transition ? getComputedStyle(transition) : null
        const animations = panel?.getAnimations({ subtree: true }) ?? []
        dropped.animations += Math.max(0, animations.length - 16)
        return {
          name,
          mounted: Boolean(panel),
          visible: visible(panel),
          // These are DOM observations, not a replacement for the app's outcome predicate.
          inputUsable:
            input instanceof HTMLInputElement &&
            !input.disabled &&
            visible(input),
          codeUsable:
            code instanceof HTMLElement &&
            code.isContentEditable &&
            visible(code),
          filesUsable: visible(files) && visible(file),
          opacity: style?.opacity ?? null,
          transform: style?.transform ?? null,
          transitionDuration: style?.transitionDuration ?? null,
          transitionDelay: style?.transitionDelay ?? null,
          animations: animations.slice(0, 16).map((animation) => ({
            kind:
              animation instanceof CSSTransition
                ? 'transition'
                : animation instanceof CSSAnimation
                  ? 'animation'
                  : 'other',
            property:
              animation instanceof CSSTransition
                ? animation.transitionProperty
                : null,
            target:
              animation.effect instanceof KeyframeEffect
                ? targetName(animation.effect.target)
                : 'none',
            playState: animation.playState,
            pending: animation.pending,
            startTime:
              typeof animation.startTime === 'number'
                ? animation.startTime
                : null,
            currentTime:
              typeof animation.currentTime === 'number'
                ? animation.currentTime
                : null,
          })),
        }
      })
    }
    const frames: {
      frameTime: number | null
      observedAt: number
      observationDurationMs: number
      panels: ReturnType<typeof readPanels>
    }[] = []

    function captureInput(event: Event) {
      if (!event.isTrusted) return
      if (inputs.length === maxRecords) {
        dropped.inputs++
        return
      }
      const target = event
        .composedPath()
        .find((entry) => entry instanceof Element)
      inputs.push({
        name: event.type,
        timeStamp: event.timeStamp,
        observedAt: performance.now(),
        pointerId: event instanceof PointerEvent ? event.pointerId : null,
        annotationId:
          target instanceof Element
            ? (target
                .closest('[data-interaction-id]')
                ?.getAttribute('data-interaction-id') ?? null)
            : null,
      })
    }

    function captureTransition(event: Event) {
      if (
        !(event instanceof TransitionEvent) ||
        !(event.target instanceof Element)
      )
        return
      const target = targetName(event.target)
      if (target === 'other') return
      if (transitions.length === maxRecords) {
        dropped.transitions++
        return
      }
      transitions.push({
        name: event.type,
        timeStamp: event.timeStamp,
        observedAt: performance.now(),
        target,
        property: event.propertyName,
        elapsedTime: event.elapsedTime,
      })
    }

    function consume(entries: PerformanceEntry[]) {
      for (const entry of entries) {
        if (
          !('interactionId' in entry) ||
          typeof entry.interactionId !== 'number' ||
          !('processingStart' in entry) ||
          typeof entry.processingStart !== 'number' ||
          !('processingEnd' in entry) ||
          typeof entry.processingEnd !== 'number'
        )
          continue
        if (eventTiming.length === maxRecords) {
          dropped.eventTiming++
          continue
        }
        eventTiming.push({
          name: entry.name,
          startTime: entry.startTime,
          processingStart: entry.processingStart,
          processingEnd: entry.processingEnd,
          duration: entry.duration,
          interactionId: entry.interactionId,
          observedAt: performance.now(),
        })
      }
    }
    const eventTimingSupported =
      PerformanceObserver.supportedEntryTypes.includes('event')
    const observer = eventTimingSupported
      ? new PerformanceObserver((list) => consume(list.getEntries()))
      : null
    const inputEvents = ['pointerdown', 'pointerup', 'click']
    const transitionEvents = [
      'transitionrun',
      'transitionstart',
      'transitionend',
      'transitioncancel',
    ]

    function stop(
      reason: 'explicit' | 'time-limit' | 'frame-limit' = 'explicit'
    ) {
      if (stoppedAt === null) {
        stoppedAt = performance.now()
        stoppedBy = reason
        if (frame !== undefined) cancelAnimationFrame(frame)
        if (deadline !== undefined) clearTimeout(deadline)
        for (const name of inputEvents)
          document.removeEventListener(name, captureInput, true)
        for (const name of transitionEvents)
          document.removeEventListener(name, captureTransition, true)
        if (observer) {
          consume(observer.takeRecords())
          observer.disconnect()
        }
      }
      return {
        timeOrigin,
        startedAt,
        stoppedAt,
        exportedAt: performance.now(),
        stoppedBy,
        durationLimitMs,
        maxRecords,
        eventTimingSupported,
        dropped,
        inputs,
        eventTiming,
        transitions,
        frames,
      }
    }

    function captureFrame(frameTime?: number) {
      const observedAt = performance.now()
      const panels = readPanels()
      frames.push({
        frameTime: frameTime ?? null,
        observedAt,
        observationDurationMs: performance.now() - observedAt,
        panels,
      })
      if (frames.length === maxRecords) {
        stop('frame-limit')
        return
      }
      frame = requestAnimationFrame(captureFrame)
    }

    observer?.observe({ type: 'event', durationThreshold: 16 })
    for (const name of inputEvents)
      document.addEventListener(name, captureInput, true)
    for (const name of transitionEvents)
      document.addEventListener(name, captureTransition, true)
    deadline = window.setTimeout(() => stop('time-limit'), durationLimitMs)
    captureFrame()
    return { stop }
  })
}

export async function stopInteractionDiagnostics(
  collector: Awaited<ReturnType<typeof startInteractionDiagnostics>>,
  testInfo: TestInfo
) {
  try {
    const diagnostics = await collector.evaluate((session) => session.stop())
    await testInfo.attach('interaction-diagnostics', {
      body: JSON.stringify(
        {
          diagnosticOnly: true,
          scenario: testInfo.title,
          repeatIndex: testInfo.repeatEachIndex,
          diagnostics,
        },
        null,
        2
      ),
      contentType: 'application/json',
    })
  } finally {
    await collector.dispose()
  }
}
