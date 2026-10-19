import type {
  InteractionDefinition,
  InteractionInputEvent,
  InteractionOutcome,
  InteractionSample,
  InteractionSnapshot,
  InteractionTiming,
} from '@src/lib/interactionPerformance/types'

const MAX_SAMPLES = 1000
// Expensive model edits may genuinely take seconds. Keep collecting their real
// outcome instead of turning known latency debt into an unmeasured timeout.
const OUTCOME_TIMEOUT_MS = 30_000
const INPUT_EVENTS: readonly InteractionInputEvent[] = [
  'click',
  'auxclick',
  'contextmenu',
]

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
  private events = new Set<InteractionInputEvent>(INPUT_EVENTS)
  private activeDefinitions: readonly InteractionDefinition[] = []
  private readyOutcomes = new Map<number, InteractionOutcome>()
  private readonly definitions: Map<string, InteractionDefinition>
  constructor(
    private readonly document: Document,
    definitions: readonly InteractionDefinition[]
  ) {
    this.definitions = new Map(
      definitions.map((definition) => [definition.id, definition])
    )
    this.activeDefinitions = definitions
  }

  start(interactionIds?: readonly string[]) {
    const selected: InteractionDefinition[] = []
    for (const id of interactionIds ?? this.definitions.keys()) {
      const definition = this.definitions.get(id)
      if (!definition) return new Error(`Unknown interaction: ${id}`)
      selected.push(definition)
    }
    this.stop()
    this.activeDefinitions = selected
    this.events = new Set<InteractionInputEvent>([
      ...INPUT_EVENTS,
      ...this.activeDefinitions.flatMap(
        ({ events }): readonly InteractionInputEvent[] => events ?? ['click']
      ),
    ])
    this.samples = []
    this.samplesByTimestamp.clear()
    this.pointerTimestamps.clear()
    this.interactionByTimestamp.clear()
    this.timings.clear()
    this.samplesByInteraction.clear()
    this.clearOutcomes()
    this.sequence = 0
    this.droppedSamples = 0
    this.droppedPointerEvents = 0
    this.visibilityInterrupted = this.document.visibilityState !== 'visible'
    this.active = true
    for (const event of this.events) {
      if (event === 'resize') {
        this.document.defaultView?.addEventListener(event, this.capture, true)
      } else {
        this.document.addEventListener(event, this.capture, true)
      }
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
      registered: this.activeDefinitions.map(
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
    for (const event of this.events) {
      if (event === 'resize') {
        this.document.defaultView?.removeEventListener(
          event,
          this.capture,
          true
        )
      } else {
        this.document.removeEventListener(event, this.capture, true)
      }
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
    this.clearOutcomes()
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
    const target =
      event.composedPath().find((node) => node instanceof Element) ??
      (event.type === 'resize' ? this.document.documentElement : undefined)
    // Both builds use the same selectors and pre-action state, independent of
    // measurement annotations added or removed by the application revision.
    const matchingDefinitions =
      target instanceof Element
        ? this.activeDefinitions.filter(
            (definition) =>
              (definition.events ?? ['click']).some(
                (type) => type === event.type
              ) &&
              definition.matchesTarget(target) &&
              (definition.matchesEvent?.(event, target) ?? true)
          )
        : []
    // A control's primary action does not describe its context menu or middle
    // click. Keep those inputs in discovery without claiming that action ran.
    const id =
      matchingDefinitions.length === 1 ? matchingDefinitions[0].id : null
    // Discovery retains unknown clicks. Do not flood it with unrelated hover,
    // typing, resize, or perpetual animation events.
    if (id === null && !INPUT_EVENTS.some((type) => type === event.type)) return
    const definition = matchingDefinitions[0]
    const pending = definition?.coalesce
      ? this.samples.find(
          (sample) => sample.id === id && sample.status === 'pending'
        )
      : undefined
    if (pending && target instanceof Element) {
      if (definition.coalesce === 'last') {
        // Trailing input work starts at the last native event in the gesture,
        // not the automation call that requested it.
        this.samplesByTimestamp.delete(pending.startTime)
        pending.startTime = event.timeStamp
        pending.renderOpportunityMs = null
        this.samplesByTimestamp.set(pending.startTime, pending)
        this.setOutcome(
          pending.sequence,
          definition.prepareOutcome?.(this.document, target, event) ??
            (() => definition.isReady(this.document))
        )
      }
      return
    }
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
    const inputType = [...this.events].find((type) => type === event.type)
    if (inputType) sample.inputType = inputType
    if (id && target instanceof Element) {
      this.setOutcome(
        sample.sequence,
        definition.prepareOutcome?.(this.document, target, event) ??
          (() => definition.isReady(this.document))
      )
    }
    if (this.samples.length === MAX_SAMPLES) {
      const removed = this.samples.shift()
      if (removed) {
        this.samplesByTimestamp.delete(removed.startTime)
        this.clearOutcome(removed.sequence)
      }
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

  private setOutcome(
    sequence: number,
    outcome: (() => boolean) | InteractionOutcome
  ) {
    this.clearOutcome(sequence)
    this.readyOutcomes.set(
      sequence,
      typeof outcome === 'function'
        ? { isReady: outcome, dispose: () => {} }
        : outcome
    )
  }

  private clearOutcome(sequence: number) {
    const outcome = this.readyOutcomes.get(sequence)
    this.readyOutcomes.delete(sequence)
    outcome?.dispose()
  }

  private clearOutcomes() {
    for (const sequence of this.readyOutcomes.keys())
      this.clearOutcome(sequence)
  }

  private scheduleObservation() {
    if (!this.active || this.frame !== undefined || this.task !== undefined)
      return
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined
      const ready = new Map(
        this.samples
          .filter(
            (sample) =>
              sample.status === 'pending' &&
              sample.id &&
              this.readyOutcomes.get(sample.sequence)?.isReady()
          )
          .map((sample) => [sample, sample.startTime])
      )
      // Observe the ready outcome in a task after this rendering opportunity.
      this.task = window.setTimeout(() => this.observeOutcomes(ready), 0)
    })
  }

  private observeOutcomes = (ready: ReadonlyMap<InteractionSample, number>) => {
    this.task = undefined
    for (const sample of this.samples) {
      if (sample.status !== 'pending') continue
      const elapsed = performance.now() - sample.startTime
      sample.renderOpportunityMs ??= elapsed
      const definition = sample.id ? this.definitions.get(sample.id) : undefined
      if (!definition) {
        sample.status = 'unattributed'
      } else if (
        ready.get(sample) === sample.startTime &&
        this.readyOutcomes.get(sample.sequence)?.isReady()
      ) {
        sample.outcomeMs = performance.now() - sample.startTime
        sample.status = 'complete'
        this.clearOutcome(sample.sequence)
      } else if (elapsed >= OUTCOME_TIMEOUT_MS) {
        sample.status = 'timeout'
        this.clearOutcome(sample.sequence)
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
