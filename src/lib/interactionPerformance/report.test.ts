import { reportInteractions } from '@src/lib/interactionPerformance/report'
import type {
  InteractionSample,
  InteractionSnapshot,
} from '@src/lib/interactionPerformance/types'
import { describe, expect, it } from 'vitest'

const id = 'zds.commandPalette.open'

function sample(sequence: number, outcomeMs: number): InteractionSample {
  return {
    sequence,
    id,
    targetTag: 'BUTTON',
    startTime: 1000 + sequence * 1000,
    renderOpportunityMs: 20,
    outcomeMs,
    eventTiming: null,
    status: 'complete',
  }
}

function snapshot(samples: InteractionSample[]): InteractionSnapshot {
  return {
    samples,
    registered: [{ id, outcome: 'The command search is ready.' }],
    eventTimingSupported: true,
    droppedSamples: 0,
    visibilityInterrupted: false,
  }
}

describe('interaction performance reports', () => {
  it('retains a slow invocation even when later invocations are fast', () => {
    const result = reportInteractions(
      snapshot([sample(1, 300), sample(2, 50), sample(3, 60)]),
      { [id]: 3 }
    )

    expect(result.errors).toEqual([])
    expect(result.violations).toEqual([
      { sequence: 1, id, metric: 'outcome', durationMs: 300 },
    ])
    expect(result.coverage).toEqual([
      {
        id,
        outcome: 'The command search is ready.',
        expected: 3,
        exercised: 3,
        measured: 3,
        eventTimingMeasured: 0,
        maximumMs: 300,
        responsivenessMaximumMs: null,
        p50Ms: 60,
        p95Ms: 300,
      },
    ])
  })

  it('treats exactly 150ms as failing an under-150ms budget', () => {
    const result = reportInteractions(
      snapshot([sample(1, 149.9), sample(2, 150)]),
      {
        [id]: 2,
      }
    )

    expect(result.violations).toEqual([
      { sequence: 2, id, metric: 'outcome', durationMs: 150 },
    ])
  })

  it('reports slow input responsiveness even when the click outcome was fast', () => {
    const slowPointerDown = sample(1, 30)
    slowPointerDown.eventTiming = {
      durationMs: 280,
      inputDelayMs: 10,
      processingMs: 250,
      presentationDelayMs: 20,
    }
    const result = reportInteractions(snapshot([slowPointerDown]), { [id]: 1 })

    expect(result.errors).toEqual([])
    expect(result.violations).toEqual([
      { sequence: 1, id, metric: 'responsiveness', durationMs: 280 },
    ])
    expect(result.coverage[0].maximumMs).toBe(30)
    expect(result.coverage[0].responsivenessMaximumMs).toBe(280)
    expect(result.coverage[0].eventTimingMeasured).toBe(1)
  })

  it('rejects a missing capture instead of treating zero samples as fast', () => {
    const result = reportInteractions(snapshot([]), { [id]: 1 })

    expect(result.errors).toContain(`Expected 1 samples for ${id}; received 0.`)
    expect(result.coverage[0].maximumMs).toBeNull()
  })

  it('rejects a lost or unfinished sample even when another invocation completed', () => {
    const unfinished = sample(2, 50)
    unfinished.outcomeMs = null
    unfinished.status = 'timeout'
    const capture = snapshot([sample(1, 20), unfinished])
    capture.droppedSamples = 1
    capture.visibilityInterrupted = true
    const result = reportInteractions(capture, { [id]: 2 })

    expect(result.errors).toEqual([
      'Capture dropped 1 samples.',
      'The document was hidden during capture.',
      `Sample 2 (${id}) has no completed outcome.`,
    ])
    expect(result.coverage[0].measured).toBe(1)
  })

  it('rejects duplicate records and malformed durations', () => {
    const invalid = sample(1, Number.NaN)
    invalid.renderOpportunityMs = -1
    const result = reportInteractions(snapshot([sample(1, 20), invalid]), {
      [id]: 2,
    })

    expect(result.errors).toEqual([
      'Sample 1 has a duplicate sequence.',
      'Sample 1 has no valid render measurement.',
      `Sample 1 (${id}) has no completed outcome.`,
    ])
  })

  it('reports unexercised identities and unattributed clicks as coverage gaps', () => {
    const unattributed = sample(1, 25)
    unattributed.id = null
    unattributed.outcomeMs = null
    unattributed.status = 'unattributed'
    const result = reportInteractions(snapshot([unattributed]), {})

    expect(result.errors).toEqual([])
    expect(result.unattributed).toBe(1)
    expect(result.coverage[0]).toMatchObject({
      expected: null,
      exercised: 0,
      measured: 0,
      maximumMs: null,
    })
  })
})
