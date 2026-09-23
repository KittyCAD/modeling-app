import type {
  InteractionSample,
  InteractionSnapshot,
} from '@src/lib/interactionPerformance/types'

export const INTERACTION_BUDGET_MS = 150

export interface InteractionCoverage {
  id: string
  outcome: string
  budgetMs: number
  expected: number | null
  exercised: number
  measured: number
  eventTimingMeasured: number
  maximumMs: number | null
  responsivenessMaximumMs: number | null
  p50Ms: number | null
  p95Ms: number | null
}

export interface InteractionReport {
  errors: string[]
  coverage: InteractionCoverage[]
  unattributed: number
  violations: {
    sequence: number
    id: string
    metric: 'responsiveness' | 'outcome'
    durationMs: number
  }[]
}

/** Validate collection independently from the report-only latency budget. */
export function reportInteractions(
  snapshot: InteractionSnapshot,
  expected: Readonly<Record<string, number>>
): InteractionReport {
  const errors: string[] = []
  const violations: InteractionReport['violations'] = []
  const registered = new Map(
    snapshot.registered.map((definition) => [definition.id, definition])
  )
  const sequences = new Set<number>()
  const finiteDuration = (value: number | null) =>
    value !== null && Number.isFinite(value) && value >= 0

  for (const { id, budgetMs } of snapshot.registered) {
    if (
      !Number.isFinite(budgetMs) ||
      budgetMs <= 0 ||
      budgetMs > INTERACTION_BUDGET_MS
    ) {
      errors.push(
        `Interaction ${id} needs a positive budget no greater than ${INTERACTION_BUDGET_MS} ms.`
      )
    }
  }
  if (snapshot.droppedSamples !== 0) {
    errors.push(`Capture dropped ${snapshot.droppedSamples} samples.`)
  }
  if (snapshot.droppedPointerEvents !== 0) {
    errors.push(
      `Capture dropped ${snapshot.droppedPointerEvents} pointer events.`
    )
  }
  if (snapshot.visibilityInterrupted) {
    errors.push('The document was hidden during capture.')
  }
  if (registered.size !== snapshot.registered.length) {
    errors.push('Interaction identities are duplicated.')
  }

  for (const sample of snapshot.samples) {
    if (sequences.has(sample.sequence)) {
      errors.push(`Sample ${sample.sequence} has a duplicate sequence.`)
    }
    sequences.add(sample.sequence)
    if (!finiteDuration(sample.startTime)) {
      errors.push(`Sample ${sample.sequence} has an invalid input timestamp.`)
    }
    if (!finiteDuration(sample.renderOpportunityMs)) {
      errors.push(`Sample ${sample.sequence} has no valid render measurement.`)
    }
    if (
      sample.eventTiming !== null &&
      !Object.values(sample.eventTiming).every(finiteDuration)
    ) {
      errors.push(`Sample ${sample.sequence} has invalid Event Timing data.`)
    }
    if (sample.id === null) continue
    const definition = registered.get(sample.id)
    if (!definition) {
      errors.push(`Sample ${sample.sequence} has an unregistered identity.`)
    }
    if (
      sample.eventTiming !== null &&
      finiteDuration(sample.eventTiming.durationMs) &&
      definition &&
      sample.eventTiming.durationMs >= definition.budgetMs
    ) {
      violations.push({
        sequence: sample.sequence,
        id: sample.id,
        metric: 'responsiveness',
        durationMs: sample.eventTiming.durationMs,
      })
    }
    if (sample.status !== 'complete' || !finiteDuration(sample.outcomeMs)) {
      errors.push(
        `Sample ${sample.sequence} (${sample.id}) has no completed outcome.`
      )
    } else if (
      sample.outcomeMs !== null &&
      definition &&
      sample.outcomeMs >= definition.budgetMs
    ) {
      violations.push({
        sequence: sample.sequence,
        id: sample.id,
        metric: 'outcome',
        durationMs: sample.outcomeMs,
      })
    }
  }

  for (const [id, count] of Object.entries(expected)) {
    if (!registered.has(id)) {
      errors.push(`Expected interaction ${id} is not registered.`)
    }
    if (!Number.isInteger(count) || count <= 0) {
      errors.push(`Expected interaction ${id} needs a positive sample count.`)
    }
    const actual = snapshot.samples.filter((sample) => sample.id === id).length
    if (actual !== count) {
      errors.push(`Expected ${count} samples for ${id}; received ${actual}.`)
    }
  }

  const coverage = snapshot.registered.map(({ id, outcome, budgetMs }) => {
    const samples = snapshot.samples.filter((sample) => sample.id === id)
    const durations = samples
      .filter(
        (sample): sample is InteractionSample & { outcomeMs: number } =>
          sample.status === 'complete' && finiteDuration(sample.outcomeMs)
      )
      .map((sample) => sample.outcomeMs)
      .sort((a, b) => a - b)
    const percentile = (fraction: number) =>
      durations[Math.ceil(durations.length * fraction) - 1] ?? null
    const responsivenessDurations = samples.flatMap((sample) =>
      sample.eventTiming !== null &&
      finiteDuration(sample.eventTiming.durationMs)
        ? [sample.eventTiming.durationMs]
        : []
    )

    return {
      id,
      outcome,
      budgetMs,
      expected: expected[id] ?? null,
      exercised: samples.length,
      measured: durations.length,
      eventTimingMeasured: responsivenessDurations.length,
      maximumMs: durations.at(-1) ?? null,
      responsivenessMaximumMs: responsivenessDurations.length
        ? Math.max(...responsivenessDurations)
        : null,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
    }
  })

  return {
    errors,
    coverage,
    unattributed: snapshot.samples.filter((sample) => sample.id === null)
      .length,
    violations,
  }
}
