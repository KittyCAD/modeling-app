import type {
  InteractionDefinition,
  InteractionSample,
  InteractionSnapshot,
  InteractionTiming,
} from '@src/lib/interactionPerformance/types'

const MAX_SAMPLES = 1000
const OUTCOME_TIMEOUT_MS = 5000
const INPUT_EVENTS = ['click', 'auxclick', 'contextmenu']

type EventTimingEntry = PerformanceEntry & {
  interactionId: number
  processingStart: number
  processingEnd: number
}

function isEventTimingEntry(
  entry: PerformanceEntry
): entry is EventTimingEntry {
  return (
    'interactionId' in entry &&
    typeof entry.interactionId === 'number' &&
    'processingStart' in entry &&
    typeof entry.processingStart === 'number' &&
    'processingEnd' in entry &&
    typeof entry.processingEnd === 'number'
  )
}

/** A bounded, opt-in recording session owned by the app registry. No network I/O. */
export class InteractionRecorder {
  private samples: InteractionSample[] = []
  private samplesByTimestamp = new Map<number, InteractionSample>()
  private pointerTimestamps = new Map<number, number[]>()
  private interactionByTimestamp = new Map<number, number>()
  private timings = new Map<number, InteractionTiming>()
  private samplesByInteraction = new Map<number, InteractionSample>()
  private observer: PerformanceObserver | undefined
  private frame: number | undefined
  private task: number | undefined
  private active = false
  private sequence = 0
  private droppedSamples = 0
  private droppedPointerEvents = 0
  private visibilityInterrupted = false
  private readonly definitions: Map<string, InteractionDefinition>
  constructor(
    private readonly document: Document,
    definitions: readonly InteractionDefinition[]
  ) {
    this.definitions = new Map(
      definitions.map((definition) => [definition.id, definition])
    )
  }

  start() {
    this.stop()
    this.samples = []
    this.samplesByTimestamp.clear()
    this.pointerTimestamps.clear()
    this.interactionByTimestamp.clear()
    this.timings.clear()
    this.samplesByInteraction.clear()
    this.sequence = 0
    this.droppedSamples = 0
    this.droppedPointerEvents = 0
    this.visibilityInterrupted = this.document.visibilityState !== 'visible'
    this.active = true
    for (const event of INPUT_EVENTS) {
      this.document.addEventListener(event, this.capture, true)
    }
    this.document.addEventListener('pointerdown', this.capturePointer, true)
    this.document.addEventListener('pointerup', this.capturePointer, true)
    this.document.addEventListener('pointercancel', this.capturePointer, true)
    this.document.addEventListener('visibilitychange', this.onVisibilityChange)
    this.observer = new PerformanceObserver((list) =>
      this.consume(list.getEntries())
    )
    this.observer.observe({ type: 'event', durationThreshold: 16 })
  }

  snapshot(): InteractionSnapshot {
    if (this.observer) this.consume(this.observer.takeRecords())
    return {
      samples: this.samples.map((sample) => ({
        ...sample,
        eventTiming: sample.eventTiming ? { ...sample.eventTiming } : null,
      })),
      registered: [...this.definitions.values()].map(
        ({ id, testId, budgetMs, outcome }) => ({
          id,
          testId,
          budgetMs,
          outcome,
        })
      ),
      droppedSamples: this.droppedSamples,
      droppedPointerEvents: this.droppedPointerEvents,
      visibilityInterrupted: this.visibilityInterrupted,
    }
  }

  stop(): InteractionSnapshot {
    const result = this.snapshot()
    this.active = false
    this.observer?.disconnect()
    this.observer = undefined
    for (const event of INPUT_EVENTS) {
      this.document.removeEventListener(event, this.capture, true)
    }
    this.document.removeEventListener('pointerdown', this.capturePointer, true)
    this.document.removeEventListener('pointerup', this.capturePointer, true)
    this.document.removeEventListener(
      'pointercancel',
      this.capturePointer,
      true
    )
    this.document.removeEventListener(
      'visibilitychange',
      this.onVisibilityChange
    )
    if (this.frame !== undefined) cancelAnimationFrame(this.frame)
    if (this.task !== undefined) window.clearTimeout(this.task)
    this.frame = undefined
    this.task = undefined
    return result
  }

  private onVisibilityChange = () => {
    if (this.document.visibilityState !== 'visible')
      this.visibilityInterrupted = true
  }

  private capturePointer = (event: PointerEvent) => {
    if (!event.isTrusted) return
    if (event.type === 'pointercancel') {
      this.pointerTimestamps.delete(event.pointerId)
    } else if (event.type === 'pointerdown') {
      // Refresh insertion order when a pointer ID is reused without a click.
      this.pointerTimestamps.delete(event.pointerId)
      this.pointerTimestamps.set(event.pointerId, [event.timeStamp])
    } else {
      this.pointerTimestamps.get(event.pointerId)?.push(event.timeStamp)
    }
    if (this.pointerTimestamps.size > MAX_SAMPLES) {
      const oldest = this.pointerTimestamps.entries().next().value
      if (oldest !== undefined) {
        this.droppedPointerEvents += oldest[1].length
        this.pointerTimestamps.delete(oldest[0])
      }
    }
  }

  private capture = (event: Event) => {
    if (!event.isTrusted) return
    const target = event.composedPath().find((node) => node instanceof Element)
    // Both builds use the same selectors and pre-action state, independent of
    // measurement annotations added or removed by the application revision.
    const matchingDefinitions =
      target instanceof Element
        ? [...this.definitions.values()].filter((definition) =>
            definition.matchesTarget(target)
          )
        : []
    // A control's primary action does not describe its context menu or middle
    // click. Keep those inputs in discovery without claiming that action ran.
    const id =
      event.type === 'click' && matchingDefinitions.length === 1
        ? matchingDefinitions[0].id
        : null
    const timestamps =
      event instanceof PointerEvent
        ? (this.pointerTimestamps.get(event.pointerId) ?? [])
        : []
    if (event instanceof PointerEvent)
      this.pointerTimestamps.delete(event.pointerId)
    const sample: InteractionSample = {
      sequence: ++this.sequence,
      id,
      targetTag:
        target instanceof Element ? target.tagName.toLowerCase() : 'unknown',
      // Include pointerdown work even when Event Timing arrives after capture
      // stops. This response span also includes time holding the button down.
      startTime: timestamps[0] ?? event.timeStamp,
      renderOpportunityMs: null,
      outcomeMs: null,
      eventTiming: null,
      status: 'pending',
    }
    if (this.samples.length === MAX_SAMPLES) {
      const removed = this.samples.shift()
      if (removed) this.samplesByTimestamp.delete(removed.startTime)
      this.droppedSamples++
    }
    this.samples.push(sample)
    // The click entry may be filtered out when it is fast, even though its
    // pointerdown blocked for hundreds of milliseconds. Join using captured
    // input timestamps as well as the browser's interaction ID.
    for (const timestamp of [...timestamps, event.timeStamp]) {
      this.samplesByTimestamp.set(timestamp, sample)
      const interactionId = this.interactionByTimestamp.get(timestamp)
      if (interactionId !== undefined) this.attachTiming(interactionId, sample)
    }
    while (this.samplesByTimestamp.size > MAX_SAMPLES * 3) {
      const oldest = this.samplesByTimestamp.keys().next().value
      if (oldest !== undefined) this.samplesByTimestamp.delete(oldest)
    }
    this.scheduleObservation()
  }

  private scheduleObservation() {
    if (!this.active || this.frame !== undefined || this.task !== undefined)
      return
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined
      const ready = new Set(
        this.samples.filter(
          (sample) =>
            sample.status === 'pending' &&
            sample.id &&
            this.definitions.get(sample.id)?.isReady(this.document)
        )
      )
      // Observe the ready outcome in a task after this rendering opportunity.
      this.task = window.setTimeout(() => this.observeOutcomes(ready), 0)
    })
  }

  private observeOutcomes = (ready: ReadonlySet<InteractionSample>) => {
    this.task = undefined
    for (const sample of this.samples) {
      if (sample.status !== 'pending') continue
      const elapsed = performance.now() - sample.startTime
      sample.renderOpportunityMs ??= elapsed
      const definition = sample.id ? this.definitions.get(sample.id) : undefined
      if (!definition) {
        sample.status = 'unattributed'
      } else if (ready.has(sample) && definition.isReady(this.document)) {
        sample.outcomeMs = performance.now() - sample.startTime
        sample.status = 'complete'
      } else if (elapsed >= OUTCOME_TIMEOUT_MS) {
        sample.status = 'timeout'
      }
    }
    // Pending outcomes repeat the next-frame/next-task cycle until ready or timed out.
    if (this.samples.some((sample) => sample.status === 'pending'))
      this.scheduleObservation()
  }

  private attachTiming(interactionId: number, sample: InteractionSample) {
    this.samplesByInteraction.set(interactionId, sample)
    const timing = this.timings.get(interactionId)
    if (
      timing &&
      (!sample.eventTiming ||
        timing.durationMs > sample.eventTiming.durationMs ||
        (timing.durationMs === sample.eventTiming.durationMs &&
          timing.processingMs > sample.eventTiming.processingMs))
    ) {
      sample.eventTiming = timing
    }
  }

  private consume(entries: PerformanceEntry[]) {
    for (const entry of entries) {
      if (!isEventTimingEntry(entry) || entry.interactionId === 0) continue
      const previous = this.timings.get(entry.interactionId)
      const processingMs = entry.processingEnd - entry.processingStart
      // Events dispatched in one frame can share the same rounded duration.
      // Preserve the slowest handler's breakdown when that duration ties.
      if (
        !previous ||
        entry.duration > previous.durationMs ||
        (entry.duration === previous.durationMs &&
          processingMs > previous.processingMs)
      ) {
        this.timings.set(entry.interactionId, {
          durationMs: entry.duration,
          inputDelayMs: entry.processingStart - entry.startTime,
          processingMs,
          presentationDelayMs: Math.max(
            0,
            entry.startTime + entry.duration - entry.processingEnd
          ),
        })
      }
      this.interactionByTimestamp.set(entry.startTime, entry.interactionId)
      const sample =
        this.samplesByTimestamp.get(entry.startTime) ??
        this.samplesByInteraction.get(entry.interactionId)
      if (sample) this.attachTiming(entry.interactionId, sample)
      while (this.interactionByTimestamp.size > MAX_SAMPLES * 3) {
        const oldest = this.interactionByTimestamp.keys().next().value
        if (oldest !== undefined) this.interactionByTimestamp.delete(oldest)
      }
      // Drag gestures can emit pointer events without a click to consume them.
      if (this.timings.size > MAX_SAMPLES) {
        const oldest = this.timings.keys().next().value
        if (oldest !== undefined) {
          this.timings.delete(oldest)
          this.samplesByInteraction.delete(oldest)
        }
      }
    }
  }
}
