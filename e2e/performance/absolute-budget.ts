import type { TestInfo } from '@playwright/test'
import type { PerformanceModelProfile } from '@e2e/performance/models'
import type { InteractionReport } from '@src/lib/interactionPerformance/report'

type LatencyViolation = InteractionReport['violations'][number]

interface LatencyBaseline {
  runId: string
  runAttempt: number
  testedCommit: string
  url: string
}

interface KnownLatencyDebt {
  id: string
  // The browser-only handoff has no model profile. This is an exact match,
  // never a wildcard for the same action in a modeling context.
  profile: PerformanceModelProfile | undefined
  metric: LatencyViolation['metric']
  baselineMs: number
}

interface DeferredLatencyViolation extends LatencyViolation {
  profile: PerformanceModelProfile | undefined
  baselineMs: number
  baseline: LatencyBaseline
}

export interface AbsoluteBudgetEnforcement {
  errors: readonly string[]
  violations: readonly LatencyViolation[]
  deferred: readonly DeferredLatencyViolation[]
}

export const KNOWN_LATENCY_BASELINE: LatencyBaseline = {
  runId: '39685031839',
  runAttempt: 1,
  testedCommit: 'dc23733f3e0b8ce813a52cabc2b5744bb885662f',
  url: 'https://github.com/KittyCAD/modeling-app/actions/runs/39685031839/job/119521133409',
}

export const ADDITIONAL_LATENCY_BASELINE: LatencyBaseline = {
  runId: '40586632749',
  runAttempt: 1,
  testedCommit: '3b08e8679f056fc5ef5227a9fecab42e6bbb63d2',
  url: 'https://github.com/KittyCAD/modeling-app/actions/runs/40586632749/job/122486467719',
}

type DebtRow = readonly [
  profile: PerformanceModelProfile | undefined,
  metric: LatencyViolation['metric'],
  baselineMs: number,
]

function recordedDebt(
  id: string,
  rows: readonly DebtRow[]
): KnownLatencyDebt[] {
  return rows.map(([profile, metric, baselineMs]) => ({
    id,
    profile,
    metric,
    baselineMs,
  }))
}

// Frozen, previously measured debt, not replacement budgets. Keep every profile
// and metric explicit so a new action, profile or responsiveness stall is strict.
// Raw reports still retain every breach of the unchanged 150 ms target.
const initialLatencyDebt: readonly KnownLatencyDebt[] = [
  ...recordedDebt('zds.featureTree.open', [
    ['large', 'responsiveness', 160],
    ['large-engine-error', 'responsiveness', 168],
    ['large-syntax-error', 'responsiveness', 168],
  ]),
  ...recordedDebt('zds.toolbar.extrude.open', [
    ['large', 'outcome', 375],
    ['large-engine-error', 'outcome', 367.80000000004657],
    ['large-syntax-error', 'outcome', 399.30000000004657],
    ['small', 'outcome', 201.69999999995343],
  ]),
  ...recordedDebt('zds.camera.cube.corner', [
    ['large', 'outcome', 365.70000000001164],
    ['large-engine-error', 'outcome', 253.69999999995343],
    ['large-syntax-error', 'outcome', 404.70000000001164],
    ['small', 'outcome', 298.80000000004657],
  ]),
  ...recordedDebt('zds.camera.cube.edge', [
    ['large', 'outcome', 311.5999999999767],
    ['large-engine-error', 'outcome', 355.29999999998836],
    ['large-syntax-error', 'outcome', 294.79999999998836],
    ['small', 'outcome', 240.29999999998836],
  ]),
  ...recordedDebt('zds.camera.cube.face', [
    ['large', 'outcome', 274.20000000001164],
    ['large-engine-error', 'outcome', 386.5999999999767],
    ['large-syntax-error', 'outcome', 339.9000000000233],
    ['small', 'outcome', 432.3999999999651],
  ]),
  ...recordedDebt('zds.editor.automaticExecution', [
    ['large', 'outcome', 9321.300000000047],
    ['small', 'outcome', 1152.7999999998137],
  ]),
  ...recordedDebt('zds.scene.defaultPlanes.hideAfterEdit', [
    ['large', 'outcome', 9656],
    ['small', 'outcome', 978.9000000001397],
  ]),
  ...recordedDebt('zds.scene.defaultPlanes.showAfterEdit', [
    ['large', 'outcome', 773.2000000001863],
    ['small', 'outcome', 790.6000000000931],
  ]),
  ...recordedDebt('zds.scene.hoverCode', [
    ['large', 'outcome', 202.4000000001397],
    ['large-engine-error', 'outcome', 197.89999999990687],
    ['large-syntax-error', 'outcome', 197],
    ['small', 'outcome', 154.89999999990687],
  ]),
  ...recordedDebt('zds.scene.resize', [
    ['large', 'outcome', 223.89999999990687],
    ['large-engine-error', 'outcome', 217],
    ['large-syntax-error', 'outcome', 246],
    ['small', 'outcome', 174.89999999990687],
  ]),
  ...recordedDebt('zds.sketch.edit.existing', [
    ['large', 'outcome', 774.5],
    ['small', 'outcome', 311],
  ]),
  ...recordedDebt('zds.sketch.enter.face', [
    ['large', 'outcome', 1135.5],
    ['small', 'outcome', 840],
  ]),
  ...recordedDebt('zds.sketch.enter.plane', [
    ['large', 'outcome', 900.1000000000058],
    ['small', 'outcome', 608.6000000000058],
  ]),
  ...recordedDebt('zds.sketch.exit', [
    ['large', 'outcome', 713.2999999999302],
    ['small', 'outcome', 423.69999999995343],
  ]),
  ...recordedDebt('zds.sketch.planeChooser.open', [
    ['large', 'outcome', 278.5],
    ['large-engine-error', 'outcome', 260.0999999999767],
    ['large-syntax-error', 'outcome', 263.5],
    ['small', 'outcome', 492.3999999999942],
    ['small', 'responsiveness', 400],
  ]),
  ...recordedDebt('zds.variable.apply', [
    ['large', 'outcome', 9488.300000000047],
    ['small', 'outcome', 1199.4000000000233],
  ]),
]

// This complete, zero-retry run found six more unfinished latency cases in the
// original app/recorder. Defer those exact outcomes under the same backlog policy;
// retain their own evidence instead of attributing them to the older baseline.
const additionalLatencyDebt: readonly KnownLatencyDebt[] = [
  ...recordedDebt('zds.settings.modeling.close', [
    ['large', 'outcome', 162.40000000002328],
  ]),
  ...recordedDebt('zds.zookeeper.send', [
    ['large', 'outcome', 214.80000000004657],
  ]),
  ...recordedDebt('zds.featureTree.open', [
    ['large', 'outcome', 169.60000000009313],
    ['large-syntax-error', 'outcome', 174],
    ['large-engine-error', 'outcome', 178.89999999990687],
  ]),
  ...recordedDebt('zds.browserHandoff.show', [
    [undefined, 'outcome', 438.59999999962747],
  ]),
]

const knownLatencyDebt = [
  ...initialLatencyDebt.map((entry) => ({
    ...entry,
    baseline: KNOWN_LATENCY_BASELINE,
  })),
  ...additionalLatencyDebt.map((entry) => ({
    ...entry,
    baseline: ADDITIONAL_LATENCY_BASELINE,
  })),
]

export function classifyAbsoluteBudget(
  report: InteractionReport,
  profile: PerformanceModelProfile | undefined
): AbsoluteBudgetEnforcement {
  const violations: LatencyViolation[] = []
  const deferred: DeferredLatencyViolation[] = []
  for (const violation of report.violations) {
    const known = knownLatencyDebt.find(
      (entry) =>
        entry.id === violation.id &&
        entry.profile === profile &&
        entry.metric === violation.metric
    )
    if (known) {
      deferred.push({
        ...violation,
        profile: known.profile,
        baselineMs: known.baselineMs,
        baseline: known.baseline,
      })
    } else {
      violations.push(violation)
    }
  }
  return { errors: report.errors, violations, deferred }
}

export function assertAbsoluteBudget(enforcement: AbsoluteBudgetEnforcement) {
  if (enforcement.errors.length > 0) {
    throw new Error(
      `Invalid collection is not a passing measurement:\n${enforcement.errors.join('\n')}`
    )
  }
  if (enforcement.violations.length > 0) {
    throw new Error(
      `Interaction latency budget exceeded:\n${JSON.stringify(enforcement.violations, null, 2)}`
    )
  }
}

/** Absolute suites only. Calibration and paired-regression gates stay strict. */
export async function expectAbsoluteInteractionBudget(
  report: InteractionReport,
  profile: PerformanceModelProfile | undefined,
  testInfo: TestInfo
) {
  const enforcement = classifyAbsoluteBudget(report, profile)
  await testInfo.attach('interaction-budget-enforcement', {
    body: JSON.stringify(
      {
        baselines: [KNOWN_LATENCY_BASELINE, ADDITIONAL_LATENCY_BASELINE],
        modelProfile: profile,
        ...enforcement,
      },
      null,
      2
    ),
    contentType: 'application/json',
  })
  for (const violation of enforcement.deferred) {
    testInfo.annotations.push({
      type: 'deferred-latency',
      description: `${violation.id} / ${violation.profile ?? 'no-model'} / ${violation.metric}: ${violation.durationMs.toFixed(1)} ms (150 ms target remains unmet)`,
    })
  }
  assertAbsoluteBudget(enforcement)
}
