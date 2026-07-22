import { describe, expect, test, vi } from 'vitest'
import type { StateFrom } from 'xstate'

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({ commands: { send: vi.fn() } }),
}))

import {
  type ToolbarDropdown,
  type ToolbarItem,
  buildToolbarConfig,
  getConstraintToolbarToggleEvent,
  getDefaultRecentToolbarItemIds,
  getSketchSolveToolIconMap,
  isSketchSolveConstraintToolActive,
  isSketchToolbarTransitioning,
  modelingMachineStateToToolbarModeName,
  promoteRecentToolbarItemId,
  recordRecentToolbarItemId,
  resolveRecentToolbarItems,
} from '@src/lib/toolbar'
import type { modelingMachine } from '@src/machines/modelingMachine'
import { defaultKeymap } from '@src/registry/extensions/keymap/defaultKeymap'

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

function findModelingToolbarDropdown(id: string): ToolbarDropdown | undefined {
  return buildToolbarConfig({
    send: () => {},
  }).modeling.items.find(
    (item): item is ToolbarDropdown =>
      item !== 'break' && 'array' in item && item.id === id
  )
}

function findModelingToolbarItem(id: string): ToolbarItem {
  const item = buildToolbarConfig({
    send: () => {},
  }).modeling.items.find(
    (item): item is ToolbarItem =>
      item !== 'break' && !('array' in item) && item.id === id
  )

  if (!item) {
    throw new Error(`Could not find toolbar item ${id}`)
  }

  return item
}

function getToolbarItems(
  toolbarConfig: ReturnType<typeof buildToolbarConfig>
): ToolbarItem[] {
  return Object.values(toolbarConfig).flatMap((mode) =>
    mode.items.flatMap((item) => {
      if (item === 'break') {
        return []
      }

      if ('array' in item) {
        return item.array
      }

      return [item]
    })
  )
}

describe('toolbar state helpers', () => {
  test('keeps the sketch solve toolbar visible while animating into sketch solve', () => {
    expect(
      modelingMachineStateToToolbarModeName(
        stubModelingState(['animating to sketch solve mode'])
      )
    ).toBe('sketchSolve')
    expect(
      modelingMachineStateToToolbarModeName(
        stubModelingState(['animating to existing sketch solve'])
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
    expect(
      isSketchToolbarTransitioning(
        stubModelingState(['animating to existing sketch solve'])
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

  test('hides experimental toolbar items unless sketch experimental features are enabled', () => {
    const defaultToolbarConfig = buildToolbarConfig({
      send: () => {},
    })

    expect(
      getToolbarItems(defaultToolbarConfig).filter(
        (item) => item.status === 'experimental'
      )
    ).toEqual([])
    expect(
      getToolbarItems(defaultToolbarConfig).map((item) => item.id)
    ).toContain('trim')

    const experimentalToolbarConfig = buildToolbarConfig(
      {
        send: () => {},
      },
      { showExperimentalFeatures: true }
    )

    expect(
      getToolbarItems(experimentalToolbarConfig)
        .filter((item) => item.status === 'experimental')
        .map((item) => item.id)
    ).toEqual(
      expect.arrayContaining([
        'spline',
        'blend-surface',
        'delete-face',
        'delete',
        'gear-helical',
        'gear-spur',
        'gear-herringbone',
        'gear-ring',
      ])
    )
  })

  test('opens the Delete modeling command from the transform dropdown', () => {
    const commands = { send: vi.fn() }
    const toolbarConfig = buildToolbarConfig(commands, {
      showExperimentalFeatures: true,
    })
    const deleteItem = getToolbarItems(toolbarConfig).find(
      (item) => item.id === 'delete'
    )

    if (!deleteItem) {
      throw new Error('Could not find toolbar item delete')
    }

    deleteItem.onClick({
      modelingSend: vi.fn(),
      modelingState: stubModelingState([]),
      sketchPathId: false,
      editorHasFocus: false,
      isActive: false,
      keepSelection: false,
    })

    expect(commands.send).toHaveBeenCalledWith({
      type: 'Find and select command',
      data: { name: 'Delete', groupId: 'modeling' },
    })
  })

  test('orders the GDT dropdown items by displayed name', () => {
    const gdtDropdown = findModelingToolbarDropdown('gdt')

    expect(gdtDropdown).toBeDefined()
    if (!gdtDropdown) {
      return
    }

    const titles = gdtDropdown.array.map((item) => {
      if (typeof item.title !== 'string') {
        throw new Error(`Expected ${item.id} to have a string title`)
      }

      return item.title
    })
    const sortedTitles = [...titles].sort((a, b) => a.localeCompare(b))

    expect(titles.length).toBeGreaterThan(0)
    expect(titles, 'GDT dropdown names are not sorted').toEqual(sortedTitles)
  })

  test('starts sketch solve on an already-selected plane', () => {
    const modelingSend = vi.fn()
    const sketchItem = findModelingToolbarItem('sketch')
    const modelingState = {
      context: {
        kclManager: {
          artifactGraph: new Map([
            ['plane-001', { id: 'plane-001', type: 'plane' }],
          ]),
          rustContext: { defaultPlanes: null },
          sceneInfra: { modelingSend },
        },
        selectionRanges: {
          graphSelections: [
            {
              artifact: {
                id: 'plane-001',
                type: 'plane',
              },
            },
          ],
          otherSelections: [],
        },
        store: {
          useSketchSolveMode: { current: true },
        },
      },
    } as unknown as StateFrom<typeof modelingMachine>

    sketchItem.onClick({
      modelingSend,
      modelingState,
      sketchPathId: false,
      editorHasFocus: false,
      isActive: false,
      keepSelection: false,
    })

    expect(modelingSend).toHaveBeenNthCalledWith(1, {
      type: 'Enter sketch',
      data: {
        forceNewSketch: true,
        keepDefaultPlaneVisibility: true,
      },
    })
    expect(modelingSend).toHaveBeenNthCalledWith(2, {
      type: 'Select sketch solve plane',
      data: 'plane-001',
    })
  })

  test('starts sketch solve on an already-selected default plane', () => {
    const modelingSend = vi.fn()
    const sketchItem = findModelingToolbarItem('sketch')
    const modelingState = {
      context: {
        kclManager: {
          artifactGraph: new Map(),
          rustContext: {
            defaultPlanes: { xy: 'default-plane-xy' },
          },
          sceneInfra: { modelingSend },
        },
        selectionRanges: {
          graphSelections: [],
          otherSelections: [{ id: 'default-plane-xy', name: 'XY' }],
        },
        store: {
          useSketchSolveMode: { current: true },
        },
      },
    } as unknown as StateFrom<typeof modelingMachine>

    sketchItem.onClick({
      modelingSend,
      modelingState,
      sketchPathId: false,
      editorHasFocus: false,
      isActive: false,
      keepSelection: false,
    })

    expect(modelingSend).toHaveBeenNthCalledWith(1, {
      type: 'Enter sketch',
      data: {
        forceNewSketch: true,
        keepDefaultPlaneVisibility: true,
      },
    })
    expect(modelingSend).toHaveBeenNthCalledWith(2, {
      type: 'Select sketch solve plane',
      data: 'default-plane-xy',
    })
  })

  test('offers sketching on a selected engine primitive face', () => {
    const sketchItem = findModelingToolbarItem('sketch')
    const modelingState = {
      context: {
        selectionRanges: {
          graphSelections: [],
          otherSelections: [
            {
              type: 'enginePrimitive',
              entityId: 'inner-face-id',
              parentEntityId: 'shell-id',
              primitiveIndex: 6,
              primitiveType: 'face',
            },
          ],
        },
      },
    } as unknown as StateFrom<typeof modelingMachine>

    if (typeof sketchItem.tooltipTitle !== 'function') {
      throw new Error('Expected Start Sketch to have a dynamic tooltip')
    }
    expect(
      sketchItem.tooltipTitle({
        modelingState,
        editorHasFocus: false,
        sketchPathId: false,
      } as any)
    ).toBe('Start Sketch on face')
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

  test('has a default keymap binding for every command-backed toolbar item', () => {
    const toolbarConfig = buildToolbarConfig(
      {
        send: () => {},
      },
      { showExperimentalFeatures: true }
    )
    const defaultKeymapCommands = new Set(
      defaultKeymap.bindings.map((binding) => binding.command)
    )

    const toolbarCommands = Object.values(toolbarConfig).flatMap((mode) =>
      mode.items.flatMap((item) => {
        if (item === 'break') {
          return []
        }

        if ('array' in item) {
          return item.array.flatMap((dropdownItem) =>
            dropdownItem.command ? [dropdownItem.command] : []
          )
        }

        return item.command ? [item.command] : []
      })
    )

    expect(
      [...new Set(toolbarCommands)].filter(
        (command) => !defaultKeymapCommands.has(command)
      )
    ).toEqual([])
  })
})
