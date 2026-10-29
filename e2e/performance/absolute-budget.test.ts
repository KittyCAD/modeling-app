import {
  assertAbsoluteBudget,
  classifyAbsoluteBudget,
  KNOWN_LATENCY_BASELINE,
} from '@e2e/performance/absolute-budget'
import type { PerformanceModelProfile } from '@e2e/performance/models'
import { reportInteractions } from '@src/lib/interactionPerformance/report'
import type {
  InteractionSample,
  InteractionSnapshot,
} from '@src/lib/interactionPerformance/types'
import { describe, expect, it } from 'vitest'

function collect(
  id: string,
  sample: Partial<InteractionSample> = {},
  snapshot: Partial<InteractionSnapshot> = {}
) {
  return reportInteractions(
    {
      registered: [{ id, testId: 'control', budgetMs: 150, outcome: 'Usable' }],
      samples: [
        {
          sequence: 1,
          id,
          targetTag: 'button',
          startTime: 1000,
          renderOpportunityMs: 16,
          outcomeMs: 300,
          eventTiming: null,
          status: 'complete',
          ...sample,
        },
      ],
      droppedSamples: 0,
      droppedPointerEvents: 0,
      visibilityInterrupted: false,
      ...snapshot,
    },
    { [id]: 1 }
  )
}

const slowEvent = {
  durationMs: 200,
  inputDelayMs: 10,
  processingMs: 10,
  presentationDelayMs: 180,
}
const profiles: PerformanceModelProfile[] = [
  'small',
  'large',
  'large-syntax-error',
  'large-engine-error',
]

const additionallyMeasuredDebt = (
  [
    ['zds.settings.modeling.close', 'large', 162.40000000002328],
    ['zds.zookeeper.send', 'large', 214.80000000004657],
    ['zds.featureTree.open', 'large', 169.60000000009313],
    ['zds.featureTree.open', 'large-syntax-error', 174],
    ['zds.featureTree.open', 'large-engine-error', 178.89999999990687],
    ['zds.browserHandoff.show', undefined, 438.59999999962747],
  ] satisfies readonly [
    id: string,
    profile: PerformanceModelProfile | undefined,
    durationMs: number,
  ][]
).map(([id, profile, durationMs]) => ({ id, profile, durationMs }))

describe('absolute interaction budget enforcement', () => {
  it.each(additionallyMeasuredDebt)(
    'retains the measured $id / $profile breach while deferring its outcome',
    ({ id, profile, durationMs }) => {
      const report = collect(id, { outcomeMs: durationMs })
      const original = structuredClone(report)
      const enforcement = classifyAbsoluteBudget(report, profile)

      expect(enforcement.deferred).toHaveLength(1)
      expect(enforcement.deferred[0]).toMatchObject({
        id,
        profile,
        metric: 'outcome',
        baselineMs: durationMs,
        baseline: { runId: '40586632749' },
      })
      expect(enforcement.violations).toEqual([])
      expect(report).toEqual(original)
      expect(report.coverage[0].budgetMs).toBe(150)
      expect(report.violations).toHaveLength(1)
      expect(() => assertAbsoluteBudget(enforcement)).not.toThrow()
    }
  )

  it('retains raw 150 ms breaches while deferring only the recorded metric', () => {
    const report = collect('zds.camera.cube.face', { eventTiming: slowEvent })
    const enforcement = classifyAbsoluteBudget(report, 'small')

    expect(enforcement.deferred).toEqual([
      {
        sequence: 1,
        id: 'zds.camera.cube.face',
        metric: 'outcome',
        durationMs: 300,
        profile: 'small',
        baselineMs: 432.3999999999651,
        baseline: KNOWN_LATENCY_BASELINE,
      },
    ])
    expect(enforcement.violations).toEqual([
      {
        sequence: 1,
        id: 'zds.camera.cube.face',
        metric: 'responsiveness',
        durationMs: 200,
      },
    ])
    expect(report.coverage[0].budgetMs).toBe(150)
    expect(report.violations).toHaveLength(2)
    expect(() => assertAbsoluteBudget(enforcement)).toThrow(
      'Interaction latency budget exceeded'
    )
  })

  it('defers both historically slow metrics only for the recorded chooser profile', () => {
    const report = collect('zds.sketch.planeChooser.open', {
      eventTiming: slowEvent,
    })
    const small = classifyAbsoluteBudget(report, 'small')
    expect(small.deferred.map(({ metric }) => metric)).toEqual([
      'responsiveness',
      'outcome',
    ])
    expect(() => assertAbsoluteBudget(small)).not.toThrow()

    const large = classifyAbsoluteBudget(report, 'large')
    expect(large.deferred.map(({ metric }) => metric)).toEqual(['outcome'])
    expect(large.violations.map(({ metric }) => metric)).toEqual([
      'responsiveness',
    ])
    expect(() => assertAbsoluteBudget(large)).toThrow(
      'Interaction latency budget exceeded'
    )
  })

  it('keeps feature-tree metrics tied to their own baseline and small models strict', () => {
    const report = collect('zds.featureTree.open', { eventTiming: slowEvent })
    const large = classifyAbsoluteBudget(report, 'large')
    expect(
      large.deferred.map(({ metric, baseline }) => [metric, baseline.runId])
    ).toEqual([
      ['responsiveness', '39685031839'],
      ['outcome', '40586632749'],
    ])
    expect(large.violations).toEqual([])
    expect(() => assertAbsoluteBudget(large)).not.toThrow()

    const small = classifyAbsoluteBudget(report, 'small')
    expect(small.deferred).toEqual([])
    expect(small.violations).toHaveLength(2)
  })

  it.each([
    { id: 'zds.settings.modeling.close', profile: 'large' },
    { id: 'zds.zookeeper.send', profile: 'large' },
    { id: 'zds.browserHandoff.show', profile: undefined },
    ...profiles.map((profile) => ({ id: 'zds.toolbar.extrude.open', profile })),
  ] satisfies { id: string; profile: PerformanceModelProfile | undefined }[])(
    'keeps a new input stall strict for $id / $profile',
    ({ id, profile }) => {
      const enforcement = classifyAbsoluteBudget(
        collect(id, { eventTiming: slowEvent }),
        profile
      )
      expect(enforcement.deferred.map(({ metric }) => metric)).toEqual([
        'outcome',
      ])
      expect(enforcement.violations.map(({ metric }) => metric)).toEqual([
        'responsiveness',
      ])
      expect(() => assertAbsoluteBudget(enforcement)).toThrow(
        'Interaction latency budget exceeded'
      )
    }
  )

  it('does not defer invalid browser captures or reuse their debt for a model', () => {
    const invalid = classifyAbsoluteBudget(
      collect(
        'zds.browserHandoff.show',
        { outcomeMs: null, status: 'timeout' },
        { visibilityInterrupted: true }
      ),
      undefined
    )
    expect(invalid.errors.length).toBeGreaterThan(0)
    expect(() => assertAbsoluteBudget(invalid)).toThrow(
      'Invalid collection is not a passing measurement'
    )

    const otherContext = classifyAbsoluteBudget(
      collect('zds.browserHandoff.show'),
      'small'
    )
    expect(otherContext.deferred).toEqual([])
    expect(() => assertAbsoluteBudget(otherContext)).toThrow()
  })

  it('keeps unrecorded profiles, Home, and new controls strict', () => {
    const report = collect('zds.variable.apply')
    const unrecordedProfiles: (PerformanceModelProfile | undefined)[] = [
      undefined,
      'large-syntax-error',
    ]
    for (const profile of unrecordedProfiles) {
      const enforcement = classifyAbsoluteBudget(report, profile)
      expect(enforcement.deferred).toEqual([])
      expect(() => assertAbsoluteBudget(enforcement)).toThrow()
    }
    const newControl = classifyAbsoluteBudget(
      collect('zds.newControl.open'),
      'large'
    )
    expect(newControl.deferred).toEqual([])
    expect(() => assertAbsoluteBudget(newControl)).toThrow()
  })

  it('does not label a now-fast known interaction as deferred debt', () => {
    const report = collect('zds.camera.cube.face', { outcomeMs: 149.9 })
    const enforcement = classifyAbsoluteBudget(report, 'small')
    expect(enforcement.deferred).toEqual([])
    expect(() => assertAbsoluteBudget(enforcement)).not.toThrow()
  })

  it('keeps the 150 ms boundary strict for an unlisted control', () => {
    const enforcement = classifyAbsoluteBudget(
      collect('zds.newControl.open', { outcomeMs: 150 }),
      'small'
    )
    expect(enforcement.violations[0].durationMs).toBe(150)
    expect(() => assertAbsoluteBudget(enforcement)).toThrow()
  })

  it('keeps collection errors blocking even when every latency breach is known debt', () => {
    const report = collect(
      'zds.camera.cube.face',
      {},
      { droppedSamples: 1, visibilityInterrupted: true }
    )
    const enforcement = classifyAbsoluteBudget(report, 'small')
    expect(enforcement.deferred).toHaveLength(1)
    expect(enforcement.violations).toEqual([])
    expect(report.errors).toHaveLength(2)
    expect(enforcement.errors).toEqual(report.errors)
    expect(() => assertAbsoluteBudget(enforcement)).toThrow(
      'Invalid collection is not a passing measurement'
    )
  })
})
