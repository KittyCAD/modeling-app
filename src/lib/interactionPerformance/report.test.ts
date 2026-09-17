import { reportInteractions } from '@src/lib/interactionPerformance/report'
import type {
  InteractionDescription,
  InteractionSample,
  InteractionSnapshot,
  InteractionTiming,
} from '@src/lib/interactionPerformance/types'
import { describe, expect, it } from 'vitest'

const id = 'zds.commandPalette.open'
const open: InteractionDescription = {
  id,
  testId: 'command-bar-open-button',
  budgetMs: 150,
  outcome: 'The command search is ready.',
}
const close: InteractionDescription = {
  id: 'zds.commandPalette.close',
  testId: 'command-bar-close-button',
  budgetMs: 20,
  outcome: 'The command palette is closed.',
}

function sample(
  sequence: number,
  id: string | null,
  outcomeMs: number | null,
  overrides: Partial<InteractionSample> = {}
): InteractionSample {
  return {
    sequence,
    id,
    targetTag: 'button',
    startTime: 1000 + sequence * 1000,
    renderOpportunityMs: 20,
    outcomeMs,
    eventTiming: null,
    status: 'complete',
    ...overrides,
  }
}

function snapshot(
  samples: InteractionSample[],
  registered: InteractionDescription[],
  overrides: Partial<InteractionSnapshot> = {}
): InteractionSnapshot {
  return {
    samples,
    registered,
    droppedSamples: 0,
    droppedPointerEvents: 0,
    visibilityInterrupted: false,
    ...overrides,
  }
}

function syntheticTiming(
  components: Omit<InteractionTiming, 'durationMs'>
): InteractionTiming {
  // Synthetic fixtures can sum these; real browser durations retain their rounding.
  return {
    ...components,
    durationMs:
      components.inputDelayMs +
      components.processingMs +
      components.presentationDelayMs,
  }
}

describe('interaction performance reports', () => {
  it('retains a slow invocation and keeps results separate for each interaction', () => {
    const result = reportInteractions(
      snapshot(
        [
          sample(1, id, 300),
          sample(2, close.id, 25),
          sample(3, id, 50),
          sample(4, id, 60),
        ],
        [open, close]
      ),
      { [id]: 3, [close.id]: 1 }
    )

    expect(result.errors).toEqual([])
    expect(result.violations).toEqual([
      { sequence: 1, id, metric: 'outcome', durationMs: 300 },
      { sequence: 2, id: close.id, metric: 'outcome', durationMs: 25 },
    ])
    expect(result.coverage).toEqual([
      {
        id,
        outcome: open.outcome,
        budgetMs: 150,
        expected: 3,
        exercised: 3,
        measured: 3,
        eventTimingMeasured: 0,
        maximumMs: 300,
        responsivenessMaximumMs: null,
        p50Ms: 60,
        p95Ms: 300,
      },
      {
        id: close.id,
        outcome: close.outcome,
        budgetMs: 20,
        expected: 1,
        exercised: 1,
        measured: 1,
        eventTimingMeasured: 0,
        maximumMs: 25,
        responsivenessMaximumMs: null,
        p50Ms: 25,
        p95Ms: 25,
      },
    ])
  })

  it('reports exactly 150ms against an under-150ms budget', () => {
    const result = reportInteractions(
      snapshot([sample(1, id, 149.9), sample(2, id, 150)], [open]),
      {
        [id]: 2,
      }
    )

    expect(result.violations).toEqual([
      { sequence: 2, id, metric: 'outcome', durationMs: 150 },
    ])
  })

  it.each([0, Number.NaN, 151])(
    'reports an invalid interaction budget of %s instead of silently accepting it',
    (budgetMs) => {
      const result = reportInteractions(
        snapshot([sample(1, id, 25)], [{ ...open, budgetMs }]),
        { [id]: 1 }
      )

      expect(result.errors).toEqual([
        `Interaction ${id} needs a positive budget no greater than 150 ms.`,
      ])
    }
  )

  it('reports slow input responsiveness even when the click outcome was fast', () => {
    const slowPointerDown = sample(1, id, 30, {
      eventTiming: syntheticTiming({
        inputDelayMs: 10,
        processingMs: 250,
        presentationDelayMs: 20,
      }),
    })
    const result = reportInteractions(snapshot([slowPointerDown], [open]), {
      [id]: 1,
    })

    expect(result.errors).toEqual([])
    expect(result.violations).toEqual([
      { sequence: 1, id, metric: 'responsiveness', durationMs: 280 },
    ])
    expect(result.coverage[0].maximumMs).toBe(30)
    expect(result.coverage[0].responsivenessMaximumMs).toBe(280)
    expect(result.coverage[0].eventTimingMeasured).toBe(1)
  })

  it('rejects a missing capture instead of treating zero samples as fast', () => {
    const result = reportInteractions(snapshot([], [open]), { [id]: 1 })

    expect(result.errors).toContain(`Expected 1 samples for ${id}; received 0.`)
    expect(result.coverage[0].maximumMs).toBeNull()
  })

  it('rejects a lost or unfinished sample even when another invocation completed', () => {
    const unfinished = sample(2, id, null, { status: 'timeout' })
    const capture = snapshot([sample(1, id, 20), unfinished], [open], {
      droppedSamples: 1,
      droppedPointerEvents: 2,
      visibilityInterrupted: true,
    })
    const result = reportInteractions(capture, { [id]: 2 })

    expect(result.errors).toEqual([
      'Capture dropped 1 samples.',
      'Capture dropped 2 pointer events.',
      'The document was hidden during capture.',
      `Sample 2 (${id}) has no completed outcome.`,
    ])
    expect(result.coverage[0].measured).toBe(1)
  })

  it('reports collection errors for duplicate records and malformed durations', () => {
    const invalid = sample(1, id, Number.NaN, { renderOpportunityMs: -1 })
    const result = reportInteractions(
      snapshot([sample(1, id, 20), invalid], [open]),
      { [id]: 2 }
    )

    expect(result.errors).toEqual([
      'Sample 1 has a duplicate sequence.',
      'Sample 1 has no valid render measurement.',
      `Sample 1 (${id}) has no completed outcome.`,
    ])
  })

  it('reports an unannotated click and an unexercised action without inventing latency', () => {
    // A newly added control has no interaction annotation; this scenario also
    // never exercises the registered close action.
    const unattributed = sample(2, null, null, { status: 'unattributed' })
    const result = reportInteractions(
      snapshot([sample(1, id, 25), unattributed], [open, close]),
      { [id]: 1 }
    )

    expect(result.errors).toEqual([])
    expect(result.unattributed).toBe(1)
    expect(result.coverage.find((row) => row.id === close.id)).toMatchObject({
      expected: null,
      exercised: 0,
      measured: 0,
      maximumMs: null,
    })
  })
})
