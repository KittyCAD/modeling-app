import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  COMPARISON_ACTIONS,
  COMPARISON_PLAN,
} from '@e2e/performance/comparison'
import type { ComparisonSessionIdentity } from '@e2e/performance/comparison'
import {
  COMPARISON_PROBES,
  reportComparisonRun,
} from '@e2e/performance/comparison-report'
import type { ComparisonAttempt } from '@e2e/performance/comparison-report'
import { interactions } from '@src/lib/interactionPerformance/definitions'
import { reportInteractions } from '@src/lib/interactionPerformance/report'
import type {
  InteractionSample,
  InteractionSnapshot,
} from '@src/lib/interactionPerformance/types'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

function capture(
  session?: Readonly<ComparisonSessionIdentity>,
  delay = 0
): InteractionSnapshot {
  const actions = COMPARISON_ACTIONS[session?.context ?? 'home']
  const samples = Array.from({ length: session ? 11 : 1 }, (_, cycle) =>
    actions.map(
      (id, action): InteractionSample => ({
        id,
        sequence: cycle * actions.length + action + 1,
        startTime: (cycle * actions.length + action + 1) * 1000,
        targetTag: 'button',
        renderOpportunityMs: 16,
        outcomeMs: 64 + delay,
        status: 'complete',
        eventTiming: {
          durationMs: 64 + delay,
          inputDelayMs: 8,
          processingMs: 8,
          presentationDelayMs: 48 + delay,
        },
      })
    )
  ).flat()
  return {
    samples,
    registered: Object.values(interactions),
    droppedSamples: 0,
    droppedPointerEvents: 0,
    visibilityInterrupted: false,
  }
}

function measurement(
  snapshot: InteractionSnapshot,
  scenario: string,
  comparison?: Readonly<ComparisonSessionIdentity>
) {
  // Exercise the real serialized producer contract, including intentional errors.
  const expected = Object.fromEntries(
    COMPARISON_ACTIONS[comparison?.context ?? 'home'].map((id) => [
      id,
      comparison ? 11 : 1,
    ])
  )
  return JSON.stringify({
    metadata: {
      scenario,
      comparison,
      calibrationFault: 'none',
      electron: '40.8.5',
      gpu: { devices: [{ deviceString: 'test GPU' }] },
    },
    snapshot,
    report: reportInteractions(snapshot, expected),
  })
}

function attempts(candidateDelay = 0): ComparisonAttempt[] {
  const results = COMPARISON_PLAN.map(
    (session): ComparisonAttempt => ({
      testId: `${session.block}/${session.variant}/${session.context}`,
      project: 'comparison',
      status: 'passed',
      expectedStatus: 'passed',
      retry: 0,
      repeatIndex: 0,
      measurements: [
        measurement(
          capture(
            session,
            session.variant === 'candidate' ? candidateDelay : 0
          ),
          `comparison.${session.context}`,
          session
        ),
      ],
    })
  )
  for (const project of ['harness-base', 'harness-candidate']) {
    for (const scenario of COMPARISON_PROBES) {
      const snapshot = capture()
      if (scenario === 'harness.missing-click') snapshot.samples = []
      results.push({
        testId: scenario,
        project,
        status: 'passed',
        expectedStatus: 'passed',
        retry: 0,
        repeatIndex: 0,
        measurements: [measurement(snapshot, scenario)],
      })
    }
  }
  return results
}

describe('serialized comparison report consumer', () => {
  it('accepts complete passing evidence and preserves intentional missing-click probe captures', () => {
    const result = reportComparisonRun(attempts())
    expect(result.status).toBe('no-regression')
    expect(result.collectionErrors).toEqual([])
    expect(result.captures).toHaveLength(50)
    expect(result.captures[0].metadata).toEqual({
      scenario: 'comparison.home',
      comparison: COMPARISON_PLAN[0],
      calibrationFault: 'none',
      electron: '40.8.5',
      gpu: { devices: [{ deviceString: 'test GPU' }] },
    })
    const missing = result.captures.filter(
      (row) => row.scenario === 'harness.missing-click'
    )
    expect(missing).toHaveLength(2)
    expect(missing.every((row) => row.snapshot.samples.length === 0)).toBe(true)
    const serialized: unknown = JSON.parse(JSON.stringify(result))
    expect(serialized).toMatchObject({
      status: 'no-regression',
      attempts: expect.any(Array),
      captures: expect.any(Array),
    })
  })

  it('evaluates attached raw captures rather than using passing test status as the performance decision', () => {
    const result = reportComparisonRun(attempts(32))
    expect(result.status).toBe('regressed')
    expect(result.failures).toHaveLength(48)
    expect(result.attempts.every((row) => row.status === 'passed')).toBe(true)
    expect(result.targetBreaches).toEqual([])
  })

  it('does not hide incomplete Event Timing behind a passing test', () => {
    const input = attempts()
    const snapshot = capture(COMPARISON_PLAN[0])
    snapshot.samples[0].eventTiming = null
    input[0].measurements = [
      measurement(snapshot, 'comparison.home', COMPARISON_PLAN[0]),
    ]
    const result = reportComparisonRun(input)
    expect(result.status).toBe('no-regression')
    expect(result.unavailablePresentationStrata).toBe(1)
    expect(
      result.strata.filter((row) => row.status === 'unavailable')
    ).toHaveLength(1)
  })

  it('rejects empty or filtered execution and a missing required probe', () => {
    expect(reportComparisonRun([]).status).toBe('invalid')
    expect(reportComparisonRun(attempts().slice(0, 40)).status).toBe('invalid')
    const input = attempts()
    input.pop()
    const result = reportComparisonRun(input)
    expect(result.status).toBe('invalid')
    expect(result.collectionErrors).toContain(
      'Expected exactly one passed harness-candidate/harness.delayed-pane-content probe.'
    )
  })

  it.each(['failed', 'skipped', 'retried', 'repeated', 'expected-failure'])(
    'rejects %s execution even with valid attachments',
    (condition) => {
      const input = attempts()
      const probe = input[40]
      if (condition === 'failed') probe.status = 'failed'
      if (condition === 'skipped') probe.status = 'skipped'
      if (condition === 'retried') probe.retry = 1
      if (condition === 'repeated') probe.repeatIndex = 1
      if (condition === 'expected-failure') probe.expectedStatus = 'failed'
      expect(reportComparisonRun(input).status).toBe('invalid')
    }
  )

  it('rejects duplicate test attempts and duplicate probe identities', () => {
    const duplicate = attempts()
    duplicate.push(duplicate[40])
    expect(reportComparisonRun(duplicate).collectionErrors).toContain(
      'Duplicate test attempt: harness-base/harness.delayed-click.'
    )
    const mislabeled = attempts()
    mislabeled[41].measurements = mislabeled[40].measurements
    const result = reportComparisonRun(mislabeled)
    expect(result.status).toBe('invalid')
    expect(result.collectionErrors).toContain(
      'Expected exactly one passed harness-base/harness.delayed-pointerdown probe.'
    )
  })

  it('rejects malformed or duplicate measurement attachments without trusting arbitrary JSON', () => {
    for (const bodies of [
      [],
      [null],
      ['{'],
      ['null'],
      [
        JSON.stringify({
          metadata: {
            scenario: 'comparison.home',
            comparison: COMPARISON_PLAN[0],
          },
          snapshot: { samples: 'invalid' },
        }),
      ],
      [
        measurement(
          capture(COMPARISON_PLAN[0]),
          'comparison.home',
          COMPARISON_PLAN[0]
        ),
        measurement(
          capture(COMPARISON_PLAN[0]),
          'comparison.home',
          COMPARISON_PLAN[0]
        ),
      ],
    ]) {
      const input = attempts()
      input[0].measurements = bodies
      const result = reportComparisonRun(input)
      expect(result.status).toBe('invalid')
      expect(result.collectionErrors).toContain(
        'Missing, duplicate, or malformed measurement attachment: comparison/0/base/home.'
      )
    }
  })

  it('preserves observed execution order and rejects probes before collection', () => {
    const reordered = attempts()
    ;[reordered[0], reordered[2]] = [reordered[2], reordered[0]]
    expect(reportComparisonRun(reordered).status).toBe('invalid')
    const earlyProbe = attempts()
    ;[earlyProbe[0], earlyProbe[40]] = [earlyProbe[40], earlyProbe[0]]
    const result = reportComparisonRun(earlyProbe)
    expect(result.status).toBe('invalid')
    expect(result.collectionErrors).toContain(
      'Harness probe ran before complete collection: harness-base/harness.delayed-click.'
    )
  })

  it('does not turn global execution errors into a passing comparison', () => {
    const result = reportComparisonRun(attempts(), [
      'Playwright execution ended timedout.',
    ])
    expect(result.status).toBe('invalid')
    expect(result.collectionErrors).toContain(
      'Playwright execution ended timedout.'
    )
    expect(result.captures).toHaveLength(50)
  })
})

async function runReporter(candidateDelay: number, args: string[]) {
  const directory = await mkdtemp(join(tmpdir(), 'interaction-comparison-'))
  try {
    const configPath = join(directory, 'playwright.config.cjs')
    const projects = ['comparison', 'harness-base', 'harness-candidate']
    await writeFile(
      configPath,
      `module.exports = ${JSON.stringify({
        testDir: directory,
        tsconfig: resolve('tsconfig.json'),
        workers: 1,
        retries: 0,
        repeatEach: 1,
        reporter: [[resolve('e2e/performance/reporter.ts')]],
        projects: projects.map((name) => ({
          name,
          testMatch: `${name}.spec.cjs`,
          dependencies: name === 'comparison' ? [] : ['comparison'],
        })),
      })}`
    )
    const input = attempts(candidateDelay)
    for (const project of projects) {
      // Exercise real Playwright attachments and final reporter exit status.
      // No browser or network is needed for this serialized consumer contract.
      await writeFile(
        join(directory, `${project}.spec.cjs`),
        `const { test } = require(${JSON.stringify(require.resolve('@playwright/test'))})
const rows = ${JSON.stringify(input.filter((row) => row.project === project))}
for (const row of rows) {
  test(row.testId, async ({}, info) => {
    await info.attach('interaction-measurements', {
      body: row.measurements[0],
      contentType: 'application/json',
    })
  })
}
`
      )
    }
    const child = spawn(
      process.execPath,
      [
        require.resolve('@playwright/test/cli'),
        'test',
        '--config',
        configPath,
        ...args,
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          GITHUB_STEP_SUMMARY: join(directory, 'summary.md'),
        },
        timeout: 30_000,
        killSignal: 'SIGKILL',
      }
    )
    let output = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk
    })
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
    const raw = await readFile(
      join(directory, 'test-results/interaction-performance/comparison.json'),
      'utf8'
    ).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return null
      throw error
    })
    const report: unknown = raw === null ? null : JSON.parse(raw)
    return { exitCode, output, report }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('Playwright comparison reporter', () => {
  it.each([
    { delay: 0, expected: 'no-regression', exitCode: 0 },
    { delay: 32, expected: 'regressed', exitCode: 1 },
  ])(
    'returns $expected after all passing collection tests',
    async ({ delay, expected, exitCode }) => {
      const result = await runReporter(delay, [])
      expect(result.exitCode, result.output).toBe(exitCode)
      expect(result.report).toMatchObject({
        status: expected,
        collectionErrors: [],
        attempts: Array.from({ length: 50 }, () => ({ status: 'passed' })),
      })
    },
    35_000
  )

  it('rejects an empty executed selection even when Playwright allows no tests', async () => {
    const result = await runReporter(0, [
      '--grep',
      'no-matching-scenario',
      '--pass-with-no-tests',
    ])
    expect(result.exitCode, result.output).toBe(1)
    expect(result.report).toMatchObject({ status: 'invalid', attempts: [] })
  })

  it('allows discovery without publishing a passing measurement', async () => {
    const result = await runReporter(0, ['--list'])
    expect(result.exitCode, result.output).toBe(0)
    expect(result.report).toBeNull()
  })
})
