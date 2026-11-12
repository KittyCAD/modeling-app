import {
  COMPARISON_PLAN,
  compareInteractions,
} from '@e2e/performance/comparison'
import type {
  ComparisonSession,
  ComparisonSessionIdentity,
  InteractionComparison,
} from '@e2e/performance/comparison'
import type { TestResult } from '@playwright/test/reporter'
import type {
  InteractionDescription,
  InteractionSample,
  InteractionSnapshot,
  InteractionTiming,
} from '@src/lib/interactionPerformance/types'
import { isArray } from '@src/lib/utils'

export const COMPARISON_PROBES: readonly string[] = Object.freeze([
  'harness.delayed-click',
  'harness.delayed-pointerdown',
  'harness.missing-click',
  'harness.secondary-click-restart',
  'harness.delayed-pane-content',
])

export interface ComparisonAttempt {
  testId: string
  project: string
  status: TestResult['status']
  expectedStatus: TestResult['status']
  retry: number
  repeatIndex: number
  measurements: readonly (string | null)[]
}

interface Capture {
  testId: string
  project: string
  metadata: Record<string, unknown>
  scenario: string
  comparison: ComparisonSessionIdentity | null
  snapshot: InteractionSnapshot
}

export interface ComparisonRunReport extends InteractionComparison {
  captures: Capture[]
  attempts: Omit<ComparisonAttempt, 'measurements'>[]
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !isArray(value)
}

function timing(value: unknown): InteractionTiming | null {
  if (
    !record(value) ||
    typeof value.durationMs !== 'number' ||
    typeof value.inputDelayMs !== 'number' ||
    typeof value.processingMs !== 'number' ||
    typeof value.presentationDelayMs !== 'number'
  )
    return null
  return {
    durationMs: value.durationMs,
    inputDelayMs: value.inputDelayMs,
    processingMs: value.processingMs,
    presentationDelayMs: value.presentationDelayMs,
  }
}

function snapshot(value: unknown): InteractionSnapshot | null {
  if (
    !record(value) ||
    !isArray(value.samples) ||
    !isArray(value.registered) ||
    typeof value.droppedSamples !== 'number' ||
    typeof value.droppedPointerEvents !== 'number' ||
    typeof value.visibilityInterrupted !== 'boolean'
  )
    return null
  const samples: InteractionSample[] = []
  for (const sample of value.samples) {
    if (
      !record(sample) ||
      typeof sample.sequence !== 'number' ||
      (sample.id !== null && typeof sample.id !== 'string') ||
      typeof sample.targetTag !== 'string' ||
      typeof sample.startTime !== 'number' ||
      (sample.renderOpportunityMs !== null &&
        typeof sample.renderOpportunityMs !== 'number') ||
      (sample.outcomeMs !== null && typeof sample.outcomeMs !== 'number') ||
      (sample.status !== 'pending' &&
        sample.status !== 'complete' &&
        sample.status !== 'unattributed' &&
        sample.status !== 'timeout')
    )
      return null
    const eventTiming =
      sample.eventTiming === null ? null : timing(sample.eventTiming)
    if (sample.eventTiming !== null && eventTiming === null) return null
    samples.push({
      sequence: sample.sequence,
      id: sample.id,
      targetTag: sample.targetTag,
      startTime: sample.startTime,
      renderOpportunityMs: sample.renderOpportunityMs,
      outcomeMs: sample.outcomeMs,
      status: sample.status,
      eventTiming,
    })
  }
  const registered: InteractionDescription[] = []
  for (const definition of value.registered) {
    if (
      !record(definition) ||
      typeof definition.id !== 'string' ||
      typeof definition.testId !== 'string' ||
      typeof definition.budgetMs !== 'number' ||
      typeof definition.outcome !== 'string'
    )
      return null
    registered.push({
      id: definition.id,
      testId: definition.testId,
      budgetMs: definition.budgetMs,
      outcome: definition.outcome,
    })
  }
  return {
    samples,
    registered,
    droppedSamples: value.droppedSamples,
    droppedPointerEvents: value.droppedPointerEvents,
    visibilityInterrupted: value.visibilityInterrupted,
  }
}

function identity(value: unknown): ComparisonSessionIdentity | null {
  if (
    !record(value) ||
    typeof value.block !== 'number' ||
    (value.variant !== 'base' && value.variant !== 'candidate') ||
    (value.context !== 'home' && value.context !== 'modeling')
  )
    return null
  return { block: value.block, variant: value.variant, context: value.context }
}

function parseCapture(attempt: ComparisonAttempt): Capture | null {
  const body = attempt.measurements[0]
  if (
    attempt.measurements.length !== 1 ||
    body === null ||
    body.length > 4 * 1024 * 1024
  )
    return null
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return null
  }
  if (
    !record(value) ||
    !record(value.metadata) ||
    typeof value.metadata.scenario !== 'string'
  )
    return null
  const capture = snapshot(value.snapshot)
  if (!capture) return null
  const comparison =
    value.metadata.comparison === undefined
      ? null
      : identity(value.metadata.comparison)
  if (value.metadata.comparison !== undefined && comparison === null)
    return null
  return {
    testId: attempt.testId,
    project: attempt.project,
    metadata: value.metadata,
    scenario: value.metadata.scenario,
    comparison,
    snapshot: capture,
  }
}

/** Consume the actual serialized attachments in callback order, never by title sorting. */
export function reportComparisonRun(
  attempts: readonly ComparisonAttempt[],
  executionErrors: readonly string[] = []
): ComparisonRunReport {
  const errors = [...executionErrors]
  const captures: Capture[] = []
  const sessions: ComparisonSession[] = []
  const testIds = new Set<string>()
  const probes = new Map<string, number>()
  const projectCounts = new Map<string, number>()
  let probesStarted = false
  for (const attempt of attempts) {
    const key = `${attempt.project}/${attempt.testId}`
    projectCounts.set(
      attempt.project,
      (projectCounts.get(attempt.project) ?? 0) + 1
    )
    if (testIds.has(key)) errors.push(`Duplicate test attempt: ${key}.`)
    testIds.add(key)
    if (attempt.retry !== 0 || attempt.repeatIndex !== 0)
      errors.push(`Repeated or retried test: ${key}.`)
    if (attempt.status !== 'passed' || attempt.expectedStatus !== 'passed')
      errors.push(`Test did not pass normally: ${key}.`)
    const capture = parseCapture(attempt)
    if (!capture) {
      errors.push(
        `Missing, duplicate, or malformed measurement attachment: ${key}.`
      )
      continue
    }
    captures.push(capture)
    if (attempt.project === 'comparison') {
      if (probesStarted)
        errors.push(`Comparison collection followed a harness probe: ${key}.`)
      if (!capture.comparison) {
        errors.push(`Comparison identity is missing: ${key}.`)
      } else {
        sessions.push({ ...capture.comparison, snapshot: capture.snapshot })
      }
    } else if (
      attempt.project === 'harness-base' ||
      attempt.project === 'harness-candidate'
    ) {
      probesStarted = true
      if (sessions.length !== COMPARISON_PLAN.length)
        errors.push(`Harness probe ran before complete collection: ${key}.`)
      if (
        capture.comparison !== null ||
        !COMPARISON_PROBES.includes(capture.scenario)
      ) {
        errors.push(`Unexpected harness measurement: ${key}.`)
      } else {
        const probeKey = `${attempt.project}/${capture.scenario}`
        probes.set(probeKey, (probes.get(probeKey) ?? 0) + 1)
      }
      // These tests assert their deliberate delays/missing data themselves.
      // Their snapshots must parse, but their intentional report errors are valid.
    } else {
      errors.push(`Unexpected performance project: ${attempt.project}.`)
    }
  }
  if (projectCounts.get('comparison') !== COMPARISON_PLAN.length)
    errors.push(
      `Expected exactly ${COMPARISON_PLAN.length} comparison test attempts.`
    )
  for (const project of ['harness-base', 'harness-candidate']) {
    if (projectCounts.get(project) !== COMPARISON_PROBES.length)
      errors.push(
        `Expected exactly ${COMPARISON_PROBES.length} test attempts in ${project}.`
      )
    for (const scenario of COMPARISON_PROBES) {
      if (probes.get(`${project}/${scenario}`) !== 1)
        errors.push(`Expected exactly one passed ${project}/${scenario} probe.`)
    }
  }
  const comparison = compareInteractions(sessions)
  return {
    ...comparison,
    status: errors.length ? 'invalid' : comparison.status,
    collectionErrors: [...errors, ...comparison.collectionErrors],
    captures,
    attempts: attempts.map(
      ({ measurements: _measurements, ...attempt }) => attempt
    ),
  }
}
