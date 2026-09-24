import {
  COMPARISON_ACTIONS,
  COMPARISON_PLAN,
  COMPARISON_WARM_CYCLES,
  compareInteractions,
} from '@e2e/performance/comparison'
import type {
  ComparisonSession,
  ComparisonSessionIdentity,
} from '@e2e/performance/comparison'
import { interactions } from '@src/lib/interactionPerformance/definitions'
import type { InteractionSample } from '@src/lib/interactionPerformance/types'
import { describe, expect, it } from 'vitest'

const open = interactions.commandPaletteOpen.id

interface Input {
  session: Readonly<ComparisonSessionIdentity>
  cycle: number
  sample: InteractionSample
}

function sessions(
  change: (input: Input) => InteractionSample = ({ sample }) => sample
) {
  return COMPARISON_PLAN.map(
    (session): ComparisonSession => ({
      ...session,
      snapshot: {
        registered: Object.values(interactions).map((definition) => ({
          ...definition,
        })),
        droppedSamples: 0,
        droppedPointerEvents: 0,
        visibilityInterrupted: false,
        samples: Array.from(
          { length: COMPARISON_WARM_CYCLES + 1 },
          (_, cycle) =>
            COMPARISON_ACTIONS[session.context].map((id, action) => {
              const sequence =
                cycle * COMPARISON_ACTIONS[session.context].length + action + 1
              return change({
                session,
                cycle,
                sample: {
                  sequence,
                  id,
                  targetTag: 'button',
                  startTime: sequence * 1000,
                  renderOpportunityMs: 16,
                  outcomeMs: 80,
                  eventTiming: {
                    durationMs: 80,
                    inputDelayMs: 4,
                    processingMs: 8,
                    presentationDelayMs: 68,
                  },
                  status: 'complete',
                },
              })
            })
        ).flat(),
      },
    })
  )
}

function delayed(
  sample: InteractionSample,
  delayMs: number
): InteractionSample {
  return {
    ...sample,
    outcomeMs: sample.outcomeMs === null ? null : sample.outcomeMs + delayMs,
    eventTiming:
      sample.eventTiming === null
        ? null
        : {
            ...sample.eventTiming,
            durationMs: sample.eventTiming.durationMs + delayMs,
            presentationDelayMs:
              sample.eventTiming.presentationDelayMs + delayMs,
          },
  }
}

function freeze(value: unknown) {
  if (typeof value !== 'object' || value === null) return
  Object.freeze(value)
  for (const child of Object.values(value)) freeze(child)
}

describe('paired interaction comparison', () => {
  it('compares all strata for identical complete inputs without mutating captures', () => {
    const input = sessions()
    const before = structuredClone(input)
    freeze(input)
    const result = compareInteractions(input)
    expect(result.status).toBe('no-regression')
    expect(result.collectionErrors).toEqual([])
    expect(result.failures).toEqual([])
    expect(result.strata).toHaveLength(48)
    for (const stratum of result.strata) {
      expect(stratum.completePairs).toBe(10)
      expect(stratum.medianDeltaMs).toBe(0)
      expect(stratum.pairs).toHaveLength(10)
    }
    expect(input).toEqual(before)
  })

  it('retains an isolated slow block and its absolute breaches without calling it a consistent regression', () => {
    const result = compareInteractions(
      sessions(({ session, cycle, sample }) =>
        session.block === 0 &&
        session.variant === 'candidate' &&
        session.context === 'home' &&
        cycle === 0 &&
        sample.id === open
          ? delayed(sample, 640)
          : sample
      )
    )
    expect(result.status).toBe('no-regression')
    expect(result.targetBreaches).toEqual([
      {
        block: 0,
        variant: 'candidate',
        context: 'home',
        sequence: 1,
        id: open,
        metric: 'outcome',
        durationMs: 720,
      },
      {
        block: 0,
        variant: 'candidate',
        context: 'home',
        sequence: 1,
        id: open,
        metric: 'responsiveness',
        durationMs: 720,
      },
    ])
    const first = result.strata.find(
      (row) =>
        row.context === 'home' &&
        row.id === open &&
        row.phase === 'first' &&
        row.metric === 'outcome'
    )
    expect(first?.positivePairs).toBe(1)
    expect(first?.pairs[0].deltaMs).toBe(640)
    expect(first?.pairs).toHaveLength(10)
  })

  it.each([
    { phase: 'first', delay: 32 },
    { phase: 'first', delay: 64 },
    { phase: 'warm', delay: 32 },
    { phase: 'warm', delay: 64 },
  ])(
    'detects consistent +$delay ms $phase cost independently',
    ({ phase, delay }) => {
      const result = compareInteractions(
        sessions(({ session, cycle, sample }) =>
          session.variant === 'candidate' &&
          session.context === 'home' &&
          sample.id === open &&
          (phase === 'first' ? cycle === 0 : cycle > 0)
            ? delayed(sample, delay)
            : sample
        )
      )
      expect(result.status).toBe('regressed')
      expect(result.collectionErrors).toEqual([])
      const affected = result.strata.filter((row) => row.status === 'regressed')
      expect(affected).toHaveLength(phase === 'first' ? 2 : 4)
      for (const stratum of affected) {
        expect(stratum.medianDeltaMs).toBe(delay)
        expect(stratum.positivePairs).toBe(10)
        expect(stratum.baseFirstMedianDeltaMs).toBe(delay)
        expect(stratum.candidateFirstMedianDeltaMs).toBe(delay)
        expect(stratum.phase === 'first').toBe(phase === 'first')
      }
      // These added costs can stay below 150 ms and still be regressions.
      expect(result.targetBreaches).toEqual([])
    }
  )

  it('detects one delayed warm invocation per session through the maximum, not the median', () => {
    const result = compareInteractions(
      sessions(({ session, cycle, sample }) =>
        session.variant === 'candidate' &&
        session.context === 'modeling' &&
        sample.id === interactions.codePaneOpen.id &&
        cycle === 7
          ? delayed(sample, 64)
          : sample
      )
    )
    expect(result.status).toBe('regressed')
    expect(result.failures).toEqual([
      {
        context: 'modeling',
        id: interactions.codePaneOpen.id,
        phase: 'warm-maximum',
        metric: 'outcome',
      },
      {
        context: 'modeling',
        id: interactions.codePaneOpen.id,
        phase: 'warm-maximum',
        metric: 'event-timing',
      },
    ])
    const typical = result.strata.find(
      (row) =>
        row.context === 'modeling' &&
        row.id === interactions.codePaneOpen.id &&
        row.phase === 'warm-median' &&
        row.metric === 'outcome'
    )
    expect(typical?.medianDeltaMs).toBe(0)
  })

  it('requires the practical margin and nine positive pairs', () => {
    for (const { delay, affectedBlocks, expected } of [
      { delay: 16, affectedBlocks: 10, expected: 'no-regression' },
      { delay: 24, affectedBlocks: 8, expected: 'no-regression' },
      { delay: 24, affectedBlocks: 9, expected: 'regressed' },
      { delay: -64, affectedBlocks: 10, expected: 'no-regression' },
    ]) {
      const result = compareInteractions(
        sessions(({ session, cycle, sample }) =>
          session.variant === 'candidate' &&
          session.block < affectedBlocks &&
          session.context === 'home' &&
          cycle === 0 &&
          sample.id === open
            ? delayed(sample, delay)
            : sample
        )
      )
      expect(result.status).toBe(expected)
    }
  })

  it.each([
    {
      difference: 'native A/A cancellation residue',
      candidateMs: 235.20000000001164,
      positivePairs: 8,
      expected: 'no-regression',
    },
    {
      difference: 'one microsecond increase',
      candidateMs: 235.19999999995343 + 0.001,
      positivePairs: 9,
      expected: 'regressed',
    },
  ])(
    'classifies $difference without changing the raw paired values',
    ({ candidateMs, positivePairs, expected }) => {
      const baseMs = 235.19999999995343
      const input = sessions(({ session, cycle, sample }) => {
        if (session.context !== 'modeling' || cycle !== 0 || sample.id !== open)
          return sample
        if (session.block === 8)
          return {
            ...sample,
            outcomeMs: session.variant === 'base' ? baseMs : candidateMs,
          }
        return session.variant === 'candidate'
          ? delayed(sample, session.block < 8 ? 32 : -32)
          : sample
      })
      const before = structuredClone(input)
      const result = compareInteractions(input)
      const first = result.strata.find(
        (row) =>
          row.context === 'modeling' &&
          row.id === open &&
          row.phase === 'first' &&
          row.metric === 'outcome'
      )
      expect(result.collectionErrors).toEqual([])
      expect(result.status).toBe(expected)
      expect(first?.medianDeltaMs).toBe(32)
      expect(first?.positivePairs).toBe(positivePairs)
      expect(first?.pairs[8]).toMatchObject({
        baseValues: [baseMs],
        candidateValues: [candidateMs],
        baseMs,
        candidateMs,
        deltaMs: candidateMs - baseMs,
      })
      expect(input).toEqual(before)
    }
  )

  it('makes missing Event Timing inconclusive without dropping pair slots or treating it as slow', () => {
    const input = sessions(({ session, cycle, sample }) =>
      session.block === 4 &&
      session.variant === 'base' &&
      session.context === 'home' &&
      cycle === 6 &&
      sample.id === open
        ? { ...sample, eventTiming: null }
        : sample
    )
    const result = compareInteractions(input)
    expect(result.status).toBe('inconclusive')
    expect(result.unavailablePresentationStrata).toBe(2)
    expect(result.collectionErrors).toEqual([])
    const unavailable = result.strata.filter(
      (row) => row.status === 'unavailable'
    )
    expect(unavailable.map((row) => row.phase)).toEqual([
      'warm-median',
      'warm-maximum',
    ])
    for (const stratum of unavailable) {
      expect(stratum.metric).toBe('event-timing')
      expect(stratum.completePairs).toBe(9)
      expect(stratum.pairs).toHaveLength(10)
      expect(stratum.pairs[4].baseValues).toHaveLength(10)
      expect(stratum.pairs[4].baseValues[5]).toBeNull()
      expect(stratum.pairs[4].baseMs).toBeNull()
      expect(stratum.medianDeltaMs).toBeNull()
    }
  })

  it('retains detected regressions when another metric lacks Event Timing', () => {
    const result = compareInteractions(
      sessions(({ session, cycle, sample }) => {
        if (
          session.variant !== 'candidate' ||
          cycle !== 0 ||
          sample.id !== open
        )
          return sample
        return { ...delayed(sample, 32), eventTiming: null }
      })
    )
    expect(result.status).toBe('regressed')
    expect(result.failures).toHaveLength(2)
    expect(result.strata.some((row) => row.status === 'unavailable')).toBe(true)
  })

  it('rejects a missing session instead of comparing a smaller cohort', () => {
    const input = sessions()
    input.splice(7, 1)
    const result = compareInteractions(input)
    expect(result.status).toBe('invalid')
    expect(result.collectionErrors).toContain(
      'Expected 40 sessions; received 39.'
    )
    expect(result.collectionErrors).toContain(
      'Missing session 1/base/modeling.'
    )
    expect(result.strata.every((row) => row.pairs.length === 10)).toBe(true)
  })

  it('rejects duplicate sessions and changed execution order', () => {
    const duplicate = sessions()
    duplicate[1] = duplicate[0]
    const duplicated = compareInteractions(duplicate)
    expect(duplicated.status).toBe('invalid')
    expect(duplicated.collectionErrors).toContain(
      'Duplicate session 0/base/home.'
    )
    const reordered = sessions()
    ;[reordered[0], reordered[2]] = [reordered[2], reordered[0]]
    const result = compareInteractions(reordered)
    expect(result.status).toBe('invalid')
    expect(result.collectionErrors).toContain(
      'Session 0 is out of execution order: 0/candidate/home.'
    )
  })

  it('rejects missing, extra, or reordered inputs even when IDs have plausible durations', () => {
    const missing = sessions()
    missing[0].snapshot.samples.pop()
    expect(compareInteractions(missing).status).toBe('invalid')
    const extra = sessions()
    extra[0].snapshot.samples.push({
      ...extra[0].snapshot.samples[0],
      sequence: 23,
      startTime: 23000,
    })
    expect(compareInteractions(extra).status).toBe('invalid')
    const reordered = sessions()
    const inputs = reordered[0].snapshot.samples
    ;[inputs[0], inputs[1]] = [inputs[1], inputs[0]]
    const result = compareInteractions(reordered)
    expect(result.status).toBe('invalid')
    expect(result.collectionErrors).toContain(
      '0/base/home: Input 1 is out of order.'
    )
  })

  it('rejects unfinished outcomes, invalid timing, interrupted capture, and changed definitions', () => {
    const input = sessions()
    input[0].snapshot.samples[0].status = 'timeout'
    input[1].snapshot.samples[0].outcomeMs = Number.NaN
    input[2].snapshot.visibilityInterrupted = true
    input[3].snapshot.registered[0].budgetMs = 151
    const result = compareInteractions(input)
    expect(result.status).toBe('invalid')
    expect(result.collectionErrors).toContain(
      '0/base/home: Sample 1 (zds.commandPalette.open) has no completed outcome.'
    )
    expect(result.collectionErrors).toContain(
      '0/base/modeling: Sample 1 (zds.commandPalette.open) has no completed outcome.'
    )
    expect(result.collectionErrors).toContain(
      '0/candidate/home: The document was hidden during capture.'
    )
    expect(result.collectionErrors).toContain(
      '0/candidate/modeling: Registered interaction definitions differ.'
    )
  })
})
