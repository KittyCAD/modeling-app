import { describe, expect, test } from 'vitest'
import type { StateFrom } from 'xstate'

import {
  isSketchToolbarTransitioning,
  modelingMachineStateToToolbarModeName,
} from '@src/lib/toolbar'
import type { modelingMachine } from '@src/machines/modelingMachine'

const stubModelingState = (
  activeStates: string[]
): StateFrom<typeof modelingMachine> =>
  ({
    matches: (state: string) => activeStates.includes(state),
  }) as unknown as StateFrom<typeof modelingMachine>

describe('toolbar state helpers', () => {
  test('keeps the sketch solve toolbar visible while animating into sketch solve', () => {
    expect(
      modelingMachineStateToToolbarModeName(
        stubModelingState(['animating to sketch solve mode'])
      )
    ).toBe('sketchSolve')
  })

  test('marks sketch toolbars as transitioning during camera animation states', () => {
    expect(
      isSketchToolbarTransitioning(
        stubModelingState(['animating to sketch solve mode'])
      )
    ).toBe(true)
    expect(
      isSketchToolbarTransitioning(
        stubModelingState(['animating to existing sketch'])
      )
    ).toBe(true)
  })

  test('does not mark active sketch modes as transitioning once animation is done', () => {
    expect(isSketchToolbarTransitioning(stubModelingState(['Sketch']))).toBe(
      false
    )
    expect(
      isSketchToolbarTransitioning(stubModelingState(['sketchSolveMode']))
    ).toBe(false)
  })
})
