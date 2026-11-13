import { describe, expect, it } from 'vitest'
import { ExecutionProgress } from '@src/lib/engineConnection/executionProgress'
import type { SourceRange } from '@src/lang/wasm'

const loop: SourceRange = [10, 20, 0]
const tail: SourceRange = [30, 40, 0]
const milestone = (sourceRange: SourceRange) => ({
  command: 'extrude',
  sourceRange,
})

describe('source-aligned execution progress', () => {
  it('keeps 70 real commands near the 25-command mock milestone, rather than displaying 70%', () => {
    const progress = new ExecutionProgress()
    progress.setPlan({
      count: 100,
      milestones: [
        ...Array.from({ length: 25 }, () => milestone(loop)),
        ...Array.from({ length: 75 }, () => milestone(tail)),
      ],
    })
    for (let i = 0; i < 70; i++) {
      progress.register(String(i), [loop])
      progress.complete(String(i))
    }
    expect(progress.fraction).toBeGreaterThan(0.15)
    expect(progress.fraction).toBeLessThan(0.26)
    expect(progress.estimatedTotal).toBeGreaterThan(250)
    progress.register('next', [tail])
    progress.complete('next')
    expect(progress.fraction).toBeCloseTo(0.26)
  })

  it('does not close a repeated source block on the first interleaved loop iteration', () => {
    const progress = new ExecutionProgress()
    progress.setPlan({
      count: 5,
      milestones: [loop, tail, loop, tail, [50, 60, 0] as SourceRange].map(
        milestone
      ),
    })
    progress.register('a', [loop])
    progress.complete('a')
    progress.register('b', [tail])
    progress.complete('b')
    expect(progress.fraction).toBeLessThan(0.3)
  })

  it('counts only completed requests and includes unplanned helper work', () => {
    const progress = new ExecutionProgress()
    progress.setPlan({
      count: 2,
      milestones: [milestone(loop), milestone(tail)],
    })
    progress.register('batch', [loop, loop])
    expect(progress.fraction).toBe(0)
    progress.complete('batch')
    expect(progress.fraction).toBeGreaterThan(0)
    progress.register('helper', [[21, 22, 0]])
    progress.complete('helper')
    expect(progress.estimatedTotal).toBeGreaterThan(2)
    progress.reset()
    progress.complete('batch')
    expect(progress.fraction).toBe(0)
  })
})
