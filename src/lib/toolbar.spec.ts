import { describe, expect, test } from 'vitest'
import type { StateFrom } from 'xstate'

import {
  buildToolbarConfig,
  getDefaultRecentToolbarItemIds,
  getConstraintToolbarToggleEvent,
  getSketchSolveToolIconMap,
  recordRecentToolbarItemId,
  promoteRecentToolbarItemId,
  resolveRecentToolbarItems,
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

function findConstraintsDropdown() {
  return buildToolbarConfig({
    send: () => {},
  }).sketchSolve.items.find(
    (
      item
    ): item is Exclude<
      ReturnType<typeof buildToolbarConfig>['sketchSolve']['items'][number],
      'break'
    > =>
      item !== 'break' && typeof item !== 'string' && item.id === 'constraints'
  )
}

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
      getConstraintToolbarToggleEvent(false, 'horizontalConstraintTool', true)
    ).toEqual({
      type: 'equip tool',
      data: { tool: 'horizontalConstraintTool' },
      keepSelection: true,
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

  test('keeps the sketch-solve constraints dropdown on its default visible items before use', () => {
    const constraintsDropdown = findConstraintsDropdown()

    expect(constraintsDropdown && 'array' in constraintsDropdown).toBe(true)
    if (!constraintsDropdown || !('array' in constraintsDropdown)) {
      return
    }

    expect(getDefaultRecentToolbarItemIds(constraintsDropdown)).toEqual([
      'coincident',
      'Tangent',
      'Parallel',
    ])
  })

  test('promotes an overflow constraint into the visible recent list', () => {
    const constraintsDropdown = findConstraintsDropdown()

    expect(constraintsDropdown && 'array' in constraintsDropdown).toBe(true)
    if (!constraintsDropdown || !('array' in constraintsDropdown)) {
      return
    }

    expect(
      promoteRecentToolbarItemId(
        'vertical',
        getDefaultRecentToolbarItemIds(constraintsDropdown),
        [],
        constraintsDropdown
      )
    ).toEqual(['vertical', 'coincident', 'Tangent'])
  })

  test('records recency without forcing visible buttons to reorder in place', () => {
    const constraintsDropdown = findConstraintsDropdown()

    expect(constraintsDropdown && 'array' in constraintsDropdown).toBe(true)
    if (!constraintsDropdown || !('array' in constraintsDropdown)) {
      return
    }

    const visibleItemIds = ['coincident', 'Tangent', 'Parallel']
    const recentItemIds = recordRecentToolbarItemId(
      'Tangent',
      [],
      constraintsDropdown
    )

    expect(
      resolveRecentToolbarItems(
        {
          array: constraintsDropdown.array.map((item) => ({
            id: item.id,
            isActive: false,
          })),
          visibleItemCount: constraintsDropdown.visibleItemCount,
          defaultVisibleItemIds: constraintsDropdown.defaultVisibleItemIds,
        },
        visibleItemIds
      ).visibleItems.map((item) => item.id)
    ).toEqual(visibleItemIds)

    expect(
      promoteRecentToolbarItemId(
        'vertical',
        visibleItemIds,
        recentItemIds,
        constraintsDropdown
      )
    ).toEqual(['vertical', 'coincident', 'Tangent'])
  })

  test('keeps the active constraint visible even when it was not in the recent list', () => {
    const items = [
      { id: 'coincident', isActive: false },
      { id: 'Tangent', isActive: false },
      { id: 'Parallel', isActive: false },
      { id: 'vertical', isActive: true },
    ]

    expect(
      resolveRecentToolbarItems(
        {
          array: items,
          visibleItemCount: 3,
          defaultVisibleItemIds: ['coincident', 'Tangent', 'Parallel'],
        },
        ['coincident', 'Tangent', 'Parallel']
      ).visibleItems.map((item) => item.id)
    ).toEqual(['vertical', 'coincident', 'Tangent'])
  })
})
