import { interactions } from '@src/lib/interactionPerformance/definitions'
import { reportInteractions } from '@src/lib/interactionPerformance/report'
import type {
  InteractionSample,
  InteractionSnapshot,
} from '@src/lib/interactionPerformance/types'

export const COMPARISON_BLOCK_COUNT = 10
export const COMPARISON_WARM_CYCLES = 10
export const COMPARISON_MINIMUM_DELTA_MS = 24
export const COMPARISON_MINIMUM_POSITIVE_PAIRS = 9
export const COMPARISON_TARGET_MS = 150

// Ignore up to one nanosecond of subtraction noise in sign tests. This is a
// numerical tie guard, not a clock-resolution claim; raw values stay intact.
const NUMERICAL_TIE_TOLERANCE_MS = 1e-6

export type ComparisonVariant = 'base' | 'candidate'
export type ComparisonContext = 'home' | 'modeling'
export type ComparisonPhase = 'first' | 'warm-median' | 'warm-maximum'
export type ComparisonMetric = 'outcome' | 'event-timing'

export interface ComparisonSessionIdentity {
  block: number
  variant: ComparisonVariant
  context: ComparisonContext
}

export interface ComparisonSession extends ComparisonSessionIdentity {
  snapshot: InteractionSnapshot
}

const contexts: readonly ComparisonContext[] = ['home', 'modeling']
const firstVariants: readonly ComparisonVariant[] = [
  'base',
  'candidate',
  'candidate',
  'base',
  'base',
  'candidate',
  'candidate',
  'base',
  'base',
  'candidate',
]

/** Fixed execution order, including five blocks in each variant order. */
export const COMPARISON_PLAN: readonly Readonly<ComparisonSessionIdentity>[] =
  Object.freeze(
    firstVariants.flatMap((first, block) => {
      const second: ComparisonVariant = first === 'base' ? 'candidate' : 'base'
      return [first, second].flatMap((variant) =>
        contexts.map((context) => Object.freeze({ block, variant, context }))
      )
    })
  )

export const COMPARISON_ACTIONS: Readonly<
  Record<ComparisonContext, readonly string[]>
> = Object.freeze({
  home: Object.freeze([
    interactions.commandPaletteOpen.id,
    interactions.commandPaletteClose.id,
  ]),
  modeling: Object.freeze([
    interactions.commandPaletteOpen.id,
    interactions.commandPaletteClose.id,
    interactions.codePaneClose.id,
    interactions.codePaneOpen.id,
    interactions.filesPaneOpen.id,
    interactions.filesPaneClose.id,
  ]),
})

interface PairedValues {
  block: number
  firstVariant: ComparisonVariant
  baseValues: (number | null)[]
  candidateValues: (number | null)[]
  baseMs: number | null
  candidateMs: number | null
  deltaMs: number | null
}

export interface ComparisonStratum {
  context: ComparisonContext
  id: string
  phase: ComparisonPhase
  metric: ComparisonMetric
  status: 'unavailable' | 'regressed' | 'no-regression'
  pairs: PairedValues[]
  completePairs: number
  positivePairs: number
  medianDeltaMs: number | null
  baseFirstMedianDeltaMs: number | null
  candidateFirstMedianDeltaMs: number | null
}

export interface InteractionComparison {
  status: 'invalid' | 'regressed' | 'inconclusive' | 'no-regression'
  unavailablePresentationStrata: number
  collectionErrors: string[]
  strata: ComparisonStratum[]
  failures: Pick<ComparisonStratum, 'context' | 'id' | 'phase' | 'metric'>[]
  targetBreaches: (ComparisonSessionIdentity & {
    sequence: number
    id: string
    metric: 'outcome' | 'responsiveness'
    durationMs: number
  })[]
}

function sessionKey(session: ComparisonSessionIdentity) {
  return `${session.block}/${session.variant}/${session.context}`
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((a, b) => a - b)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2
}

function duration(sample: InteractionSample, metric: ComparisonMetric) {
  const value =
    metric === 'outcome' ? sample.outcomeMs : sample.eventTiming?.durationMs
  return value !== null &&
    value !== undefined &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : null
}

function summarize(values: readonly (number | null)[], phase: ComparisonPhase) {
  const present = values.filter((value) => value !== null)
  const expected = phase === 'first' ? 1 : COMPARISON_WARM_CYCLES
  if (values.length !== expected || present.length !== expected) return null
  return phase === 'warm-maximum' ? Math.max(...present) : median(present)
}

/**
 * Compare a complete fixed schedule; never sort sessions or discard slow inputs.
 * This provisional decision rule requires A/A and real-delay calibration.
 */
export function compareInteractions(
  sessions: readonly ComparisonSession[]
): InteractionComparison {
  const collectionErrors: string[] = []
  const targetBreaches: InteractionComparison['targetBreaches'] = []
  const indexed = new Map<string, ComparisonSession>()
  const registered = Object.values(interactions)
  if (sessions.length !== COMPARISON_PLAN.length) {
    collectionErrors.push(
      `Expected ${COMPARISON_PLAN.length} sessions; received ${sessions.length}.`
    )
  }
  for (const [index, session] of sessions.entries()) {
    const key = sessionKey(session)
    const expectedSession = COMPARISON_PLAN[index]
    if (!expectedSession || key !== sessionKey(expectedSession)) {
      collectionErrors.push(
        `Session ${index} is out of execution order: ${key}.`
      )
    }
    if (indexed.has(key)) {
      collectionErrors.push(`Duplicate session ${key}.`)
    } else {
      indexed.set(key, session)
    }
    const actions = COMPARISON_ACTIONS[session.context]
    if (!actions) {
      collectionErrors.push(`Session ${key} has an unknown context.`)
      continue
    }
    const expectedCounts = Object.fromEntries(
      actions.map((id) => [id, COMPARISON_WARM_CYCLES + 1])
    )
    const report = reportInteractions(session.snapshot, expectedCounts)
    collectionErrors.push(...report.errors.map((error) => `${key}: ${error}`))
    for (const sample of session.snapshot.samples) {
      for (const metric of [
        'outcome',
        'event-timing',
      ] satisfies ComparisonMetric[]) {
        const value = duration(sample, metric)
        if (
          sample.id !== null &&
          value !== null &&
          value >= COMPARISON_TARGET_MS
        ) {
          targetBreaches.push({
            block: session.block,
            variant: session.variant,
            context: session.context,
            sequence: sample.sequence,
            id: sample.id,
            metric: metric === 'outcome' ? 'outcome' : 'responsiveness',
            durationMs: value,
          })
        }
      }
    }
    if (
      session.snapshot.registered.length !== registered.length ||
      registered.some(
        (definition) =>
          !session.snapshot.registered.some(
            (actual) =>
              actual.id === definition.id &&
              actual.testId === definition.testId &&
              actual.outcome === definition.outcome &&
              actual.budgetMs === COMPARISON_TARGET_MS
          )
      )
    ) {
      collectionErrors.push(
        `${key}: Registered interaction definitions differ.`
      )
    }
    const expectedSamples = actions.length * (COMPARISON_WARM_CYCLES + 1)
    if (session.snapshot.samples.length !== expectedSamples) {
      collectionErrors.push(
        `${key}: Expected exactly ${expectedSamples} inputs.`
      )
    }
    for (const [sampleIndex, sample] of session.snapshot.samples.entries()) {
      if (
        sample.id !== actions[sampleIndex % actions.length] ||
        sample.sequence !== sampleIndex + 1 ||
        (sampleIndex > 0 &&
          sample.startTime <=
            session.snapshot.samples[sampleIndex - 1].startTime)
      ) {
        collectionErrors.push(
          `${key}: Input ${sampleIndex + 1} is out of order.`
        )
      }
      if (
        sample.outcomeMs !== null &&
        sample.renderOpportunityMs !== null &&
        sample.outcomeMs < sample.renderOpportunityMs
      ) {
        collectionErrors.push(
          `${key}: Input ${sampleIndex + 1} precedes rendering.`
        )
      }
    }
  }
  for (const planned of COMPARISON_PLAN) {
    if (!indexed.has(sessionKey(planned))) {
      collectionErrors.push(`Missing session ${sessionKey(planned)}.`)
    }
  }

  const strata: ComparisonStratum[] = []
  const phases: readonly ComparisonPhase[] = [
    'first',
    'warm-median',
    'warm-maximum',
  ]
  const metrics: readonly ComparisonMetric[] = ['outcome', 'event-timing']
  for (const context of contexts) {
    for (const id of COMPARISON_ACTIONS[context]) {
      for (const phase of phases) {
        for (const metric of metrics) {
          const pairs = firstVariants.map(
            (firstVariant, block): PairedValues => {
              const values = (variant: ComparisonVariant) => {
                const samples = indexed
                  .get(sessionKey({ block, variant, context }))
                  ?.snapshot.samples.filter((sample) => sample.id === id)
                if (!samples) return []
                const selected =
                  phase === 'first' ? samples.slice(0, 1) : samples.slice(1)
                return selected.map((sample) => duration(sample, metric))
              }
              const baseValues = values('base')
              const candidateValues = values('candidate')
              const baseMs = summarize(baseValues, phase)
              const candidateMs = summarize(candidateValues, phase)
              return {
                block,
                firstVariant,
                baseValues,
                candidateValues,
                baseMs,
                candidateMs,
                deltaMs:
                  baseMs === null || candidateMs === null
                    ? null
                    : candidateMs - baseMs,
              }
            }
          )
          const deltas = pairs.flatMap((pair) =>
            pair.deltaMs === null ? [] : [pair.deltaMs]
          )
          const complete = deltas.length === COMPARISON_BLOCK_COUNT
          const orderMedian = (variant: ComparisonVariant) =>
            complete
              ? median(
                  pairs.flatMap((pair) =>
                    pair.firstVariant === variant && pair.deltaMs !== null
                      ? [pair.deltaMs]
                      : []
                  )
                )
              : null
          const medianDeltaMs = complete ? median(deltas) : null
          const baseFirstMedianDeltaMs = orderMedian('base')
          const candidateFirstMedianDeltaMs = orderMedian('candidate')
          const positivePairs = deltas.filter(
            (delta) => delta > NUMERICAL_TIE_TOLERANCE_MS
          ).length
          const regressed =
            medianDeltaMs !== null &&
            medianDeltaMs >= COMPARISON_MINIMUM_DELTA_MS &&
            positivePairs >= COMPARISON_MINIMUM_POSITIVE_PAIRS &&
            baseFirstMedianDeltaMs !== null &&
            baseFirstMedianDeltaMs > NUMERICAL_TIE_TOLERANCE_MS &&
            candidateFirstMedianDeltaMs !== null &&
            candidateFirstMedianDeltaMs > NUMERICAL_TIE_TOLERANCE_MS
          strata.push({
            context,
            id,
            phase,
            metric,
            pairs,
            status: !complete
              ? 'unavailable'
              : regressed
                ? 'regressed'
                : 'no-regression',
            completePairs: deltas.length,
            positivePairs,
            medianDeltaMs,
            baseFirstMedianDeltaMs,
            candidateFirstMedianDeltaMs,
          })
        }
      }
    }
  }
  const failures = strata
    .filter((stratum) => stratum.status === 'regressed')
    .map(({ context, id, phase, metric }) => ({ context, id, phase, metric }))
  return {
    status: collectionErrors.length
      ? 'invalid'
      : failures.length
        ? 'regressed'
        : strata.some(
              (stratum) =>
                stratum.metric === 'outcome' && stratum.status === 'unavailable'
            )
          ? 'inconclusive'
          : 'no-regression',
    // Optional Event Timing has no completion acknowledgment. Its missing values
    // remain unknown, while the complete outcome comparisons still own the gate.
    unavailablePresentationStrata: strata.filter(
      (stratum) =>
        stratum.metric === 'event-timing' && stratum.status === 'unavailable'
    ).length,
    collectionErrors,
    strata,
    failures,
    targetBreaches,
  }
}
