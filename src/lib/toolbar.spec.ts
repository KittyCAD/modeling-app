import { describe, expect, test } from 'vitest'
import type { StateFrom } from 'xstate'

import {
  buildToolbarConfig,
  getConstraintToolbarToggleEvent,
  getSketchSolveToolIconMap,
  isSketchSolveConstraintToolActive,
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

  test('tracks active sketch-solve constraint tools independently of the dropdown shell', () => {
    expect(
      isSketchSolveConstraintToolActive(
        {
          matches: (state) => state === 'sketchSolveMode',
          context: {
            sketchSolveToolName: 'horizontalConstraintTool',
          },
        },
        'horizontalConstraintTool'
      )
    ).toBe(true)

    expect(
      isSketchSolveConstraintToolActive(
        {
          matches: () => false,
          context: {
            sketchSolveToolName: 'horizontalConstraintTool',
          },
        },
        'horizontalConstraintTool'
      )
    ).toBe(false)
  })

  test('maps constraint dropdown clicks to equip and unequip events', () => {
    expect(
      getConstraintToolbarToggleEvent(false, 'horizontalConstraintTool')
    ).toEqual({
      type: 'equip tool',
      data: { tool: 'horizontalConstraintTool' },
    })

    expect(
      getConstraintToolbarToggleEvent(true, 'horizontalConstraintTool')
    ).toEqual({
      type: 'unequip tool',
    })
  })

  test('includes the sketch-solve constraint dropdown items in the icon map', () => {
    const toolbarConfig = buildToolbarConfig({
      send: () => {},
    })

    expect(getSketchSolveToolIconMap(toolbarConfig)).toMatchObject({
      coincidentConstraintTool: 'coincident',
      tangentConstraintTool: 'tangent',
      parallelConstraintTool: 'parallel',
      equalLengthConstraintTool: 'equal',
      horizontalConstraintTool: 'horizontal',
      verticalConstraintTool: 'vertical',
      perpendicularConstraintTool: 'perpendicular',
      fixedConstraintTool: 'fix',
    })
  })
})
