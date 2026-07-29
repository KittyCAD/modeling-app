import { useMemo } from 'react'
import type { EventFrom, StateFrom } from 'xstate'

import type { CustomIconName } from '@src/components/CustomIcon'
import { createLiteral } from '@src/lang/create'
import {
  getSelectedPlaneId,
  getSelectedSketchTarget as getSelectedSketchTargetId,
} from '@src/lang/queryAst'
import { useApp } from '@src/lib/boot'
import {
  EXPERIMENTAL_POINT_AND_CLICK_FLAG,
  SKETCH_DEFAULT_PLANE_XY,
  SKETCH_DEFAULT_PLANE_XZ,
  SKETCH_DEFAULT_PLANE_YZ,
  SKETCH_SELECTION_RGB_STR,
} from '@src/lib/constants'
import type { HotkeySequence } from '@src/lib/hotkeys'
import { isDesktop } from '@src/lib/isDesktop'
import { getSelectedDefaultPlane, selectSketchPlane } from '@src/lib/selections'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import type { modelingMachine } from '@src/machines/modelingMachine'
import {
  isEditingExistingSketch,
  pipeHasCircle,
} from '@src/machines/modelingMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { isSketchBlockSelected } from '@src/machines/sketchSolve/sketchSolveImpl'
import type { ConstraintToolName } from '@src/machines/sketchSolve/tools/constraintToolModel'
import {
  MODE_MODELING_KEYMAP_SCOPE,
  MODE_SKETCHING_KEYMAP_SCOPE,
  MODE_SKETCH_NO_FACE_KEYMAP_SCOPE,
  MODE_SKETCH_SOLVE_KEYMAP_SCOPE,
} from '@src/registry/contracts/keymap'
import { TOOLBAR_COMMAND_IDS } from '@src/registry/extensions/commands/toolbarCommands'

export type ToolbarModeName =
  | 'modeling'
  | 'sketching'
  | 'sketchSolve'
  | 'onlyCancel'

export const toolbarModeNameToKeymapScope: Record<ToolbarModeName, string> = {
  modeling: MODE_MODELING_KEYMAP_SCOPE,
  sketching: MODE_SKETCHING_KEYMAP_SCOPE,
  onlyCancel: MODE_SKETCH_NO_FACE_KEYMAP_SCOPE,
  sketchSolve: MODE_SKETCH_SOLVE_KEYMAP_SCOPE,
}

type ToolbarMode = {
  check: (state: StateFrom<typeof modelingMachine>) => boolean
  items: (ToolbarItem | ToolbarDropdown | 'break')[]
}

// Load bearing logic for determining the items in the toolbar
// Based on the state of the modeling machine determine what toolbar should be rendered
export const modelingMachineStateToToolbarModeName = (
  state: StateFrom<typeof modelingMachine>
): ToolbarModeName => {
  let toolbarConfigurationName: ToolbarModeName = 'modeling'
  if (state.matches('Sketch no face')) {
    toolbarConfigurationName = 'onlyCancel'
  } else if (
    state.matches('sketchSolveMode') ||
    state.matches('animating to sketch solve mode') ||
    state.matches('animating to existing sketch solve')
  ) {
    // Gotcha: match on the animating state otherwise you see a different toolbar
    toolbarConfigurationName = 'sketchSolve'
  } else if (state.matches('Sketch')) {
    toolbarConfigurationName = 'sketching'
  }
  return toolbarConfigurationName
}

export const isSketchToolbarTransitioning = (
  state: StateFrom<typeof modelingMachine>
): boolean =>
  state.matches('animating to plane') ||
  state.matches('animating to existing sketch') ||
  state.matches('animating to sketch solve mode') ||
  state.matches('animating to existing sketch solve')

export type ToolbarDropdown = {
  id: string
  array: ToolbarItem[]
  display?: 'default' | 'recent'
  visibleItemCount?: number
  defaultVisibleItemIds?: string[]
}

export interface ToolbarItemCallbackProps {
  modelingState: StateFrom<typeof modelingMachine>
  modelingSend: (event: EventFrom<typeof modelingMachine>) => void
  sketchPathId: string | false
  editorHasFocus: boolean | undefined
  isActive: boolean
  keepSelection: boolean
}

export type ToolbarItem = {
  id: string
  command?: string
  onClick: (props: ToolbarItemCallbackProps) => void
  icon?: CustomIconName
  sketchSolveToolName?: string
  iconColor?: string | ((props: ToolbarItemCallbackProps) => string | undefined)
  alwaysDark?: true
  status: 'available' | 'unavailable' | 'kcl-only' | 'experimental'
  disabled?: (
    state: StateFrom<typeof modelingMachine>,
    wasmInstance: ModuleType
  ) => boolean
  title: string | ((props: ToolbarItemCallbackProps) => string)
  tooltipTitle?: string | ((props: ToolbarItemCallbackProps) => string)
  showTitle?: boolean
  description: string
  extraInfo?: string
  links: { label: string; url: string }[]
  isActive?: (state: StateFrom<typeof modelingMachine>) => boolean
  disabledReason?:
    | string
    | ((state: StateFrom<typeof modelingMachine>) => string | undefined)
}

type ToolbarConfig = Record<ToolbarModeName, ToolbarMode>

function filterExperimentalToolbarConfig(
  toolbarConfig: ToolbarConfig,
  showExperimentalFeatures: boolean
): ToolbarConfig {
  if (showExperimentalFeatures) {
    return toolbarConfig
  }

  return {
    onlyCancel: filterExperimentalToolbarMode(toolbarConfig.onlyCancel),
    modeling: filterExperimentalToolbarMode(toolbarConfig.modeling),
    sketching: filterExperimentalToolbarMode(toolbarConfig.sketching),
    sketchSolve: filterExperimentalToolbarMode(toolbarConfig.sketchSolve),
  }
}

function filterExperimentalToolbarMode(toolbarMode: ToolbarMode): ToolbarMode {
  return {
    ...toolbarMode,
    items: toolbarMode.items.flatMap(filterExperimentalToolbarItem),
  }
}

function filterExperimentalToolbarItem(
  item: ToolbarMode['items'][number]
): ToolbarMode['items'] {
  if (item === 'break') {
    return [item]
  }

  if ('array' in item) {
    const array = item.array.filter(
      (dropdownItem) => dropdownItem.status !== 'experimental'
    )

    if (array.length === 0) {
      return []
    }

    const visibleItemIds = new Set(array.map(({ id }) => id))
    const defaultVisibleItemIds = item.defaultVisibleItemIds?.filter((id) =>
      visibleItemIds.has(id)
    )

    return [
      {
        ...item,
        array,
        ...(defaultVisibleItemIds ? { defaultVisibleItemIds } : {}),
      },
    ]
  }

  return item.status === 'experimental' ? [] : [item]
}

export type ToolbarItemResolved = Omit<
  ToolbarItem,
  'disabled' | 'isActive' | 'title' | 'tooltipTitle' | 'iconColor'
> & {
  title: string
  tooltipTitle?: string
  iconColor?: string
  disabled?: boolean
  hotkey?: HotkeySequence
  isActive?: boolean
  callbackProps: ToolbarItemCallbackProps
}

export type ToolbarItemResolvedDropdown = {
  id: string
  array: ToolbarItemResolved[]
  display?: 'default' | 'recent'
  visibleItemCount?: number
  defaultVisibleItemIds?: string[]
}

export const isToolbarItemResolvedDropdown = (
  item: ToolbarItemResolved | ToolbarItemResolvedDropdown
): item is ToolbarItemResolvedDropdown => {
  return 'array' in item
}

type ToolbarDropdownItemIdLike = {
  id: string
}

type ToolbarDropdownLike<T extends ToolbarDropdownItemIdLike> = {
  array: readonly T[]
  defaultVisibleItemIds?: string[]
  visibleItemCount?: number
}

export function getToolbarDropdownDisplay(
  dropdown: Pick<ToolbarDropdown, 'display'>
): 'default' | 'recent' {
  return dropdown.display ?? 'default'
}

function sortToolbarItemsByTitle<T extends ToolbarItem & { title: string }>(
  items: T[]
): T[] {
  return [...items].sort((a, b) => a.title.localeCompare(b.title))
}

export function getDefaultRecentToolbarItemIds(
  dropdown: ToolbarDropdownLike<ToolbarDropdownItemIdLike>
): string[] {
  const maxItems = dropdown.visibleItemCount ?? 3
  const fallbackVisibleItemIds = dropdown.array
    .slice(0, maxItems)
    .map((item) => item.id)
  const configuredVisibleItemIds = dropdown.defaultVisibleItemIds ?? []

  return [...configuredVisibleItemIds, ...fallbackVisibleItemIds]
    .filter(
      (itemId, index, itemIds) =>
        dropdown.array.some((item) => item.id === itemId) &&
        itemIds.indexOf(itemId) === index
    )
    .slice(0, maxItems)
}

export function promoteRecentToolbarItemId(
  itemId: string,
  currentItemIds: readonly string[],
  recentItemIds: readonly string[],
  dropdown: ToolbarDropdownLike<ToolbarDropdownItemIdLike>
): string[] {
  const maxItems = dropdown.visibleItemCount ?? 3
  const defaultItemIds = getDefaultRecentToolbarItemIds(dropdown)
  const availableItemIds = dropdown.array.map((item) => item.id)
  const currentVisibleItemIds = [...currentItemIds]
    .filter(
      (nextItemId, index, itemIds) =>
        availableItemIds.includes(nextItemId) &&
        itemIds.indexOf(nextItemId) === index
    )
    .slice(0, maxItems)
  const recencyOrder = [
    itemId,
    ...recentItemIds,
    ...defaultItemIds,
    ...availableItemIds,
  ].filter(
    (nextItemId, index, itemIds) =>
      availableItemIds.includes(nextItemId) &&
      itemIds.indexOf(nextItemId) === index
  )

  if (currentVisibleItemIds.includes(itemId)) {
    return currentVisibleItemIds
  }

  const remainingVisibleItemIds = currentVisibleItemIds.filter(
    (currentVisibleItemId) => currentVisibleItemId !== itemId
  )
  const leastRecentVisibleItemId = [...remainingVisibleItemIds].sort(
    (leftItemId, rightItemId) =>
      recencyOrder.indexOf(rightItemId) - recencyOrder.indexOf(leftItemId)
  )[0]
  const nextVisibleItemIds = remainingVisibleItemIds.filter(
    (currentVisibleItemId) => currentVisibleItemId !== leastRecentVisibleItemId
  )
  const fallbackItemIds = [...defaultItemIds, ...availableItemIds].filter(
    (nextItemId, index, itemIds) =>
      !nextVisibleItemIds.includes(nextItemId) &&
      itemIds.indexOf(nextItemId) === index
  )

  return [itemId, ...nextVisibleItemIds, ...fallbackItemIds].slice(0, maxItems)
}

export function recordRecentToolbarItemId(
  itemId: string,
  currentItemIds: readonly string[],
  dropdown: ToolbarDropdownLike<ToolbarDropdownItemIdLike>
): string[] {
  const availableItemIds = dropdown.array.map((item) => item.id)
  const defaultItemIds = getDefaultRecentToolbarItemIds(dropdown)

  return [
    itemId,
    ...currentItemIds,
    ...defaultItemIds,
    ...availableItemIds,
  ].filter(
    (nextItemId, index, itemIds) =>
      availableItemIds.includes(nextItemId) &&
      itemIds.indexOf(nextItemId) === index
  )
}

export function resolveRecentToolbarItems<
  T extends ToolbarDropdownItemIdLike & { isActive?: boolean },
>(
  dropdown: ToolbarDropdownLike<T>,
  visibleItemIds: readonly string[]
): {
  visibleItems: T[]
} {
  const maxItems = dropdown.visibleItemCount ?? 3
  const defaultItemIds = getDefaultRecentToolbarItemIds(dropdown)
  const activeItemId = dropdown.array.find((item) => item.isActive)?.id
  const resolvedVisibleItemIds = [
    ...visibleItemIds,
    ...defaultItemIds,
    ...dropdown.array.map((item) => item.id),
  ]
    .filter(
      (itemId, index, itemIds) =>
        dropdown.array.some((item) => item.id === itemId) &&
        itemIds.indexOf(itemId) === index
    )
    .slice(0, maxItems)
  const nextVisibleItemIds =
    activeItemId && !resolvedVisibleItemIds.includes(activeItemId)
      ? promoteRecentToolbarItemId(
          activeItemId,
          resolvedVisibleItemIds,
          [],
          dropdown
        )
      : resolvedVisibleItemIds
  const uniqueOrderedItemIds = nextVisibleItemIds.filter(
    (itemId, index, itemIds) =>
      dropdown.array.some((item) => item.id === itemId) &&
      itemIds.indexOf(itemId) === index
  )
  const finalVisibleItemIds = uniqueOrderedItemIds.slice(0, maxItems)
  const visibleItems = finalVisibleItemIds
    .map((itemId) => dropdown.array.find((item) => item.id === itemId))
    .filter((item): item is T => item !== undefined)
  return {
    visibleItems,
  }
}

type SketchSolveConstraintState = {
  matches: (state: 'sketchSolveMode') => boolean
  context: {
    sketchSolveToolName: string | null
  }
}

type ConstraintToolbarItemConfig = Pick<
  ToolbarItem,
  'id' | 'command' | 'icon' | 'title' | 'description'
> & {
  toolName: ConstraintToolName
}

export function isSketchSolveConstraintToolActive(
  state: SketchSolveConstraintState,
  toolName: ConstraintToolName
): boolean {
  return (
    state.matches('sketchSolveMode') &&
    state.context.sketchSolveToolName === toolName
  )
}

export function getConstraintToolbarToggleEvent(
  isActive: boolean,
  toolName: ConstraintToolName,
  keepSelection = false
): EventFrom<typeof modelingMachine> {
  return isActive
    ? { type: 'unequip tool' }
    : {
        type: 'equip tool',
        data: { tool: toolName },
        ...(keepSelection ? { keepSelection } : {}),
      }
}

function createSketchSolveConstraintDropdownItem({
  id,
  command,
  toolName,
  icon,
  title,
  description,
}: ConstraintToolbarItemConfig): ToolbarItem {
  return {
    id,
    command,
    onClick: ({ modelingSend, isActive, keepSelection }) =>
      modelingSend(
        getConstraintToolbarToggleEvent(isActive, toolName, keepSelection)
      ),
    icon,
    sketchSolveToolName: toolName,
    status: 'available',
    title,
    description,
    links: [],
    isActive: (state) => isSketchSolveConstraintToolActive(state, toolName),
  }
}

const constraintsExtraInfo = 'Hold Cmd/Ctrl to keep selection'

const sketchSolveConstraintItems: ToolbarItem[] = [
  createSketchSolveConstraintDropdownItem({
    id: 'coincident',
    command: TOOLBAR_COMMAND_IDS.sketchSolve.coincident,
    toolName: 'coincidentConstraintTool',
    icon: 'coincident',
    title: 'Coincident',
    description: 'Constrain points or curves to be coincident.',
  }),
  createSketchSolveConstraintDropdownItem({
    id: 'midpoint',
    command: TOOLBAR_COMMAND_IDS.sketchSolve.midpoint,
    toolName: 'midpointConstraintTool',
    icon: 'midpoint',
    title: 'Midpoint',
    description: 'Constrain a point to lie at the midpoint of a selected line.',
  }),
  createSketchSolveConstraintDropdownItem({
    id: 'Tangent',
    command: TOOLBAR_COMMAND_IDS.sketchSolve.tangent,
    toolName: 'tangentConstraintTool',
    icon: 'tangent',
    title: 'Tangent',
    description:
      'Constrain a selected line and arc, or two arcs, to be tangent at their shared contact.',
  }),
  createSketchSolveConstraintDropdownItem({
    id: 'Parallel',
    command: TOOLBAR_COMMAND_IDS.sketchSolve.parallel,
    toolName: 'parallelConstraintTool',
    icon: 'parallel',
    title: 'Parallel',
    description: 'Constrain lines or curves to be parallel.',
  }),
  createSketchSolveConstraintDropdownItem({
    id: 'Perpendicular',
    command: TOOLBAR_COMMAND_IDS.sketchSolve.perpendicular,
    toolName: 'perpendicularConstraintTool',
    icon: 'perpendicular',
    title: 'Perpendicular',
    description: 'Constrain lines or curves to be perpendicular.',
  }),
  createSketchSolveConstraintDropdownItem({
    id: 'equalLength',
    command: TOOLBAR_COMMAND_IDS.sketchSolve.equal,
    toolName: 'equalLengthConstraintTool',
    icon: 'equal',
    title: 'Equal',
    description:
      'Constrain lines to have equal length, or arcs and circles to have equal radius.',
  }),
  createSketchSolveConstraintDropdownItem({
    id: 'Symmetric',
    command: TOOLBAR_COMMAND_IDS.sketchSolve.symmetric,
    toolName: 'symmetricConstraintTool',
    icon: 'symmetric',
    title: 'Symmetric',
    description:
      'Constrain two points, two arc-like segments, or two lines to be symmetric across a selected axis line.',
  }),
  createSketchSolveConstraintDropdownItem({
    id: 'vertical',
    command: TOOLBAR_COMMAND_IDS.sketchSolve.vertical,
    toolName: 'verticalConstraintTool',
    icon: 'vertical',
    title: 'Vertical',
    description: 'Constrain lines to be vertical.',
  }),
  createSketchSolveConstraintDropdownItem({
    id: 'Horizontal',
    command: TOOLBAR_COMMAND_IDS.sketchSolve.horizontal,
    toolName: 'horizontalConstraintTool',
    icon: 'horizontal',
    title: 'Horizontal',
    description: 'Constrain lines to be horizontal.',
  }),
  createSketchSolveConstraintDropdownItem({
    id: 'Fixed',
    command: TOOLBAR_COMMAND_IDS.sketchSolve.fixed,
    toolName: 'fixedConstraintTool',
    icon: 'fix',
    title: 'Fixed',
    description: 'Lock selected points to their current x and y positions.',
  }),
]

type ToolbarCommands = Pick<ReturnType<typeof useApp>['commands'], 'send'>

export function buildToolbarConfig(
  commands: ToolbarCommands,
  {
    showExperimentalFeatures = false,
  }: {
    showExperimentalFeatures?: boolean
  } = {}
): ToolbarConfig {
  const splineToolbarItem: ToolbarItem = {
    id: 'spline',
    command: TOOLBAR_COMMAND_IDS.sketchSolve.spline,
    onClick: ({ modelingSend, isActive }) =>
      isActive
        ? modelingSend({
            type: 'unequip tool',
          })
        : modelingSend({
            type: 'equip tool',
            data: { tool: 'splineTool' },
          }),
    icon: 'spline',
    status: 'experimental',
    title: 'Spline',
    description: 'Draw a control-point spline.',
    links: [],
    isActive: (state) =>
      state.matches('sketchSolveMode') &&
      state.context.sketchSolveToolName === 'splineTool',
  }

  const toolbarConfig: ToolbarConfig = {
    onlyCancel: {
      check: (state) => !state.matches('Sketch no face'),
      items: [
        {
          id: 'sketch-exit',
          command: TOOLBAR_COMMAND_IDS.sketching.exit,
          onClick: ({ modelingSend }) =>
            modelingSend({
              type: 'Cancel',
            }),
          icon: 'arrowShortLeft',
          status: 'available',
          title: 'Cancel Sketch',
          showTitle: true,
          description: 'Cancel the current sketch.',
          links: [],
        },
      ],
    },
    modeling: {
      check: (state) =>
        !(
          state.matches('Sketch') ||
          state.matches('Sketch no face') ||
          state.matches('animating to existing sketch') ||
          state.matches('animating to plane') ||
          state.matches('sketchSolveMode')
        ),
      items: [
        {
          id: 'sketch',
          command: TOOLBAR_COMMAND_IDS.modeling.sketch,
          onClick: ({
            modelingSend,
            modelingState,
            sketchPathId,
            editorHasFocus,
          }) => {
            const isSketchBlock = isSketchBlockSelected(
              modelingState.context.selectionRanges
            )
            const selectedSketchTarget =
              getSelectedSketchTarget(modelingState.context.selectionRanges)
                ?.id ?? null

            // Don't force new sketch if we're in a sketch block or have a sketchBlock selected
            if ((editorHasFocus && sketchPathId) || isSketchBlock) {
              modelingSend({ type: 'Enter sketch' })
            } else if (selectedSketchTarget) {
              modelingSend({
                type: 'Enter sketch',
                data: {
                  forceNewSketch: true,
                  keepDefaultPlaneVisibility: true,
                },
              })
              void selectSketchPlane(
                selectedSketchTarget,
                modelingState.context.store.useSketchSolveMode?.current,
                modelingState.context.kclManager
              )
            } else {
              // No sketch context - start new sketch
              modelingSend({
                type: 'Enter sketch',
                data: { forceNewSketch: true },
              })
            }
          },
          icon: 'sketch',
          iconColor: ({ modelingState }) =>
            getSelectedSketchIconColor(modelingState.context.selectionRanges),
          status: 'available',
          title: ({ editorHasFocus, sketchPathId, modelingState }) => {
            const isSketchBlock = isSketchBlockSelected(
              modelingState.context.selectionRanges
            )

            if ((editorHasFocus && sketchPathId) || isSketchBlock) {
              return 'Edit Sketch'
            }

            return 'Start Sketch'
          },
          tooltipTitle: ({ editorHasFocus, sketchPathId, modelingState }) => {
            const isSketchBlock = isSketchBlockSelected(
              modelingState.context.selectionRanges
            )

            if ((editorHasFocus && sketchPathId) || isSketchBlock) {
              return 'Edit Sketch'
            }

            const selectedSketchTarget = getSelectedSketchTarget(
              modelingState.context.selectionRanges
            )
            if (selectedSketchTarget) {
              return selectedSketchTarget.title
            }

            return 'Start Sketch'
          },
          showTitle: true,
          description: 'Start drawing a 2D sketch.',
          links: [
            {
              label: 'KCL docs',
              url: withSiteBaseURL(
                '/docs/kcl-std/functions/std-sketch-startSketchOn'
              ),
            },
          ],
        },
        'break',
        {
          id: 'extrude',
          command: 'modeling:Extrude',
          onClick: () =>
            commands.send({
              type: 'Find and select command',
              data: { name: 'Extrude', groupId: 'modeling' },
            }),
          icon: 'extrude',
          status: 'available',
          title: 'Extrude',
          description:
            'Pull a sketch into 3D along its normal or perpendicular.',
          links: [
            {
              label: 'KCL docs',
              url: withSiteBaseURL(
                '/docs/kcl-std/functions/std-sketch-extrude'
              ),
            },
          ],
        },
        {
          id: 'sweep',
          command: 'modeling:Sweep',
          onClick: () =>
            commands.send({
              type: 'Find and select command',
              data: { name: 'Sweep', groupId: 'modeling' },
            }),
          icon: 'sweep',
          status: 'available',
          title: 'Sweep',
          description:
            'Create a 3D body by moving a sketch region along an arbitrary path.',
          links: [
            {
              label: 'KCL docs',
              url: withSiteBaseURL('/docs/kcl-std/functions/std-sketch-sweep'),
            },
          ],
        },
        {
          id: 'loft',
          command: 'modeling:Loft',
          onClick: () =>
            commands.send({
              type: 'Find and select command',
              data: { name: 'Loft', groupId: 'modeling' },
            }),
          icon: 'loft',
          status: 'available',
          title: 'Loft',
          description:
            'Create a 3D body by blending between two or more sketches.',
          links: [
            {
              label: 'KCL docs',
              url: withSiteBaseURL('/docs/kcl-std/functions/std-sketch-loft'),
            },
          ],
        },
        {
          id: 'revolve',
          command: 'modeling:Revolve',
          onClick: () =>
            commands.send({
              type: 'Find and select command',
              data: { name: 'Revolve', groupId: 'modeling' },
            }),
          icon: 'revolve',
          status: 'available',
          title: 'Revolve',
          description:
            'Create a 3D body by rotating a sketch region about an axis.',
          links: [
            {
              label: 'KCL docs',
              url: withSiteBaseURL(
                '/docs/kcl-std/functions/std-sketch-revolve'
              ),
            },
            {
              label: 'KCL example',
              url: withSiteBaseURL('/docs/kcl-samples/ball-bearing'),
            },
          ],
        },
        'break',
        {
          id: 'fillet3d',
          command: 'modeling:Fillet',
          onClick: () =>
            commands.send({
              type: 'Find and select command',
              data: { name: 'Fillet', groupId: 'modeling' },
            }),
          icon: 'fillet3d',
          status: 'available',
          title: 'Fillet',
          description: 'Round the edges of a 3D solid.',
          links: [
            {
              label: 'KCL docs',
              url: withSiteBaseURL('/docs/kcl-std/functions/std-solid-fillet'),
            },
          ],
        },
        {
          id: 'chamfer3d',
          command: 'modeling:Chamfer',
          onClick: () =>
            commands.send({
              type: 'Find and select command',
              data: { name: 'Chamfer', groupId: 'modeling' },
            }),
          icon: 'chamfer3d',
          status: 'available',
          title: 'Chamfer',
          description: 'Bevel the edges of a 3D solid.',
          extraInfo:
            'Chamfers cannot touch other chamfers yet. This is under development, see issue tracker.',
          links: [
            {
              label: 'issue tracker',
              url: 'https://github.com/KittyCAD/modeling-app/issues/6617',
            },
            {
              label: 'KCL docs',
              url: withSiteBaseURL('/docs/kcl-std/functions/std-solid-chamfer'),
            },
          ],
        },
        {
          id: 'shell',
          onClick: () => {
            commands.send({
              type: 'Find and select command',
              data: { name: 'Shell', groupId: 'modeling' },
            })
          },
          icon: 'shell',
          status: 'available',
          title: 'Shell',
          description: 'Hollow out a 3D solid.',
          links: [
            {
              label: 'KCL docs',
              url: withSiteBaseURL('/docs/kcl-std/functions/std-solid-shell'),
            },
          ],
        },
        {
          id: 'hole',
          onClick: () => {
            commands.send({
              type: 'Find and select command',
              data: { name: 'Hole', groupId: 'modeling' },
            })
          },
          icon: 'hole',
          status: 'available',
          title: 'Hole',
          description:
            'Standard holes that could be drilled or cut into a 3D solid.',
          links: [
            {
              label: 'KCL docs',
              url: withSiteBaseURL('/docs/kcl-std/modules/std-hole'),
            },
          ],
        },
        'break',
        {
          id: 'booleans',
          array: [
            {
              id: 'boolean-union',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'Boolean Union', groupId: 'modeling' },
                }),
              icon: 'booleanUnion',
              status: 'available',
              title: 'Union',
              description: 'Combine two or more solids into a single solid.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-solid-union'
                  ),
                },
              ],
            },
            {
              id: 'boolean-subtract',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'Boolean Subtract', groupId: 'modeling' },
                }),
              icon: 'booleanSubtract',
              status: 'available',
              title: 'Subtract',
              description: 'Subtract one solid from another.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-solid-subtract'
                  ),
                },
              ],
            },
            {
              id: 'boolean-intersect',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'Boolean Intersect', groupId: 'modeling' },
                }),
              icon: 'booleanIntersect',
              status: 'available',
              title: 'Intersect',
              description:
                'Create a solid from the intersection of two solids.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-solid-intersect'
                  ),
                },
              ],
            },
          ],
        },
        {
          id: 'split',
          onClick: () =>
            commands.send({
              type: 'Find and select command',
              data: { name: 'Boolean Split', groupId: 'modeling' },
            }),
          icon: 'split',
          status: 'available',
          title: 'Split',
          description: 'Split a solid or surface into multiple surfaces.',
          links: [
            {
              label: 'KCL docs',
              url: withSiteBaseURL('/docs/kcl-std/functions/std-solid-split'),
            },
          ],
        },
        {
          id: 'surface',
          array: [
            {
              id: 'blend-surface',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'Blend', groupId: 'modeling' },
                }),
              icon: 'blend',
              status: 'experimental',
              title: 'Blend',
              description: 'Blend two selected surface edges.',
              links: [
                {
                  label: 'API docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-solid-blend'
                  ),
                },
              ],
            },
            {
              id: 'flip-surface',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'Flip Surface', groupId: 'modeling' },
                }),
              icon: 'flipSurface',
              status: 'available',
              title: 'Flip Surface',
              description:
                'Flip the orientation of a surface, swapping which side is the front and which is the reverse.',
              links: [
                {
                  label: 'API docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-solid-flipSurface'
                  ),
                },
              ],
            },
            {
              id: 'join-surfaces',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'Join Surfaces', groupId: 'modeling' },
                }),
              status: 'available',
              icon: 'joinSurfaces',
              title: 'Join Surfaces',
              description: 'Join surfaces together.',
              links: [
                {
                  label: 'API docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-surface-joinSurfaces'
                  ),
                },
              ],
            },
            {
              id: 'delete-face',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'Delete Face', groupId: 'modeling' },
                }),
              icon: 'deleteFace',
              status: 'experimental',
              title: 'Delete Face',
              description:
                'Delete a face from a body (a solid, or a polysurface).',
              links: [
                {
                  label: 'API docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-solid-deleteFace'
                  ),
                },
              ],
            },
          ],
        },
        'break',
        {
          id: 'planes',
          array: [
            {
              id: 'plane-offset',
              command: 'modeling:Offset plane',
              onClick: () => {
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'Offset plane', groupId: 'modeling' },
                })
              },
              icon: 'plane',
              status: 'available',
              title: 'Offset Plane',
              description: 'Create a plane parallel to an existing plane.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-offsetPlane'
                  ),
                },
              ],
            },
            {
              id: 'plane-points',
              onClick: () =>
                console.error('Plane through points not yet implemented'),
              status: 'unavailable',
              title: '3-Point Plane',
              description: 'Create a plane from three points.',
              links: [],
            },
          ],
        },
        {
          id: 'helix',
          command: 'modeling:Helix',
          onClick: () => {
            commands.send({
              type: 'Find and select command',
              data: { name: 'Helix', groupId: 'modeling' },
            })
          },
          icon: 'helix',
          status: 'available',
          title: 'Helix',
          description: 'Create a helix or spiral in 3D about an axis.',
          links: [
            {
              label: 'KCL docs',
              url: withSiteBaseURL('/docs/kcl-std/functions/std-helix'),
            },
          ],
        },
        {
          id: 'gears',
          array: [
            {
              id: 'gear-helical',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'Helical Gear', groupId: 'modeling' },
                }),
              icon: 'gear',
              status: 'experimental',
              title: 'Helical Gear',
              description: 'Create a helical gear.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL('/docs/kcl-std/modules/std-gear'),
                },
              ],
            },
            {
              id: 'gear-spur',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'Spur Gear', groupId: 'modeling' },
                }),
              icon: 'gear',
              status: 'experimental',
              title: 'Spur Gear',
              description: 'Create a spur gear.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL('/docs/kcl-std/modules/std-gear'),
                },
              ],
            },
            {
              id: 'gear-herringbone',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'Herringbone Gear', groupId: 'modeling' },
                }),
              icon: 'gear',
              status: 'experimental',
              title: 'Herringbone Gear',
              description: 'Create a herringbone gear.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL('/docs/kcl-std/modules/std-gear'),
                },
              ],
            },
            {
              id: 'gear-ring',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'Ring Gear', groupId: 'modeling' },
                }),
              icon: 'gear',
              status: 'experimental',
              title: 'Ring Gear',
              description: 'Create a ring gear.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL('/docs/kcl-std/modules/std-gear'),
                },
              ],
            },
          ],
        },
        'break',
        {
          id: 'insert',
          command: 'code:Insert',
          onClick: () =>
            commands.send({
              type: 'Find and select command',
              data: { name: 'Insert', groupId: 'code' },
            }),
          icon: 'import',
          status: 'available',
          disabled: () => !isDesktop(),
          title: 'Insert',
          description: 'Insert from a file in the current project directory.',
          links: [
            {
              label: 'API docs',
              url: withSiteBaseURL('/docs/kcl-lang/modules'),
            },
          ],
        },
        {
          id: 'transform',
          array: [
            {
              id: 'translate',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'Translate', groupId: 'modeling' },
                }),
              icon: 'move',
              status: 'available',
              title: 'Translate',
              description: 'Apply a translation to a solid or sketch.',
              links: [
                {
                  label: 'API docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-transform-translate'
                  ),
                },
              ],
            },
            {
              id: 'rotate',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'Rotate', groupId: 'modeling' },
                }),
              icon: 'rotate',
              status: 'available',
              title: 'Rotate',
              description: 'Apply a rotation to a solid or sketch.',
              links: [
                {
                  label: 'API docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-transform-rotate'
                  ),
                },
              ],
            },
            {
              id: 'scale',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'Scale', groupId: 'modeling' },
                }),
              icon: 'scale',
              status: 'available',
              title: 'Scale',
              description: 'Apply scaling to a solid or sketch.',
              links: [
                {
                  label: 'API docs',
                  url: 'https://zoo.dev/docs/kcl-std/functions/std-transform-scale',
                },
              ],
            },
            {
              id: 'clone',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'Clone', groupId: 'modeling' },
                }),
              status: 'available',
              title: 'Clone',
              icon: 'clone',
              description: 'Clone a solid or sketch.',
              links: [
                {
                  label: 'API docs',
                  url: withSiteBaseURL('/docs/kcl-std/functions/std-clone'),
                },
              ],
            },
            {
              id: 'mirror3d',
              command: 'modeling:Mirror 3D',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'Mirror 3D', groupId: 'modeling' },
                }),
              icon: 'mirror3d',
              status: 'available',
              title: 'Mirror',
              description: 'Mirror solids across a plane or edge.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-transform-mirror3d'
                  ),
                },
              ],
            },
            {
              id: 'appearance',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'Appearance', groupId: 'modeling' },
                }),
              status: 'available',
              title: 'Appearance',
              icon: 'text',
              description:
                'Set the appearance of a solid. This only works on solids, not sketches or individual paths.',
              links: [
                {
                  label: 'API docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-appearance'
                  ),
                },
              ],
            },
            {
              id: 'delete',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'Delete', groupId: 'modeling' },
                }),
              status: 'experimental',
              title: 'Delete',
              icon: 'trash',
              description: 'Delete selected bodies from the scene.',
              links: [
                {
                  label: 'API docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-transform-delete'
                  ),
                },
              ],
            },
          ],
        },
        {
          id: 'pattern',
          array: [
            {
              id: 'pattern-circular-3d',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'Pattern Circular 3D', groupId: 'modeling' },
                }),
              status: 'available',
              title: 'Circular Pattern',
              icon: 'patternCircular3d',
              description:
                'Create a circular pattern of 3D solids around an axis.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-solid-patternCircular3d'
                  ),
                },
              ],
            },
            {
              id: 'pattern-linear-3d',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'Pattern Linear 3D', groupId: 'modeling' },
                }),
              status: 'available',
              title: 'Linear Pattern',
              icon: 'patternLinear3d',
              description:
                'Create a linear pattern of 3D solids along an axis.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-solid-patternLinear3d'
                  ),
                },
              ],
            },
          ],
        },
        'break',
        {
          id: 'gdt',
          array: sortToolbarItemsByTitle([
            {
              id: 'gdt-flatness',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'GDT Flatness', groupId: 'modeling' },
                }),
              status: 'available',
              title: 'Flatness',
              icon: 'gdtFlatness',
              description:
                'Specifies flatness tolerance - how much a surface can deviate from perfectly flat.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-gdt-flatness'
                  ),
                },
              ],
            },
            {
              id: 'gdt-straightness',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'GDT Straightness', groupId: 'modeling' },
                }),
              status: 'available',
              title: 'Straightness',
              icon: 'gdtStraightness',
              description:
                'Specifies straightness tolerance - how much a face or edge can deviate from perfectly straight.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-gdt-straightness'
                  ),
                },
              ],
            },
            {
              id: 'gdt-circularity',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'GDT Circularity', groupId: 'modeling' },
                }),
              status: 'available',
              title: 'Circularity',
              icon: 'gdtCircularity',
              description:
                'Specifies circularity tolerance - how much a round face or edge can deviate from a perfect circle.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-gdt-circularity'
                  ),
                },
              ],
            },
            {
              id: 'gdt-cylindricity',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'GDT Cylindricity', groupId: 'modeling' },
                }),
              status: 'available',
              title: 'Cylindricity',
              icon: 'gdtCylindricity',
              description:
                'Specifies cylindricity tolerance - how much a round face or edge can deviate from a perfect cylinder.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-gdt-cylindricity'
                  ),
                },
              ],
            },
            {
              id: 'gdt-datum',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'GDT Datum', groupId: 'modeling' },
                }),
              status: 'available',
              title: 'Datum',
              icon: 'gdtDatum',
              description:
                'Establishes a reference surface for other GD&T measurements.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL('/docs/kcl-std/functions/std-gdt-datum'),
                },
              ],
            },
            {
              id: 'gdt-profile',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'GDT Profile', groupId: 'modeling' },
                }),
              status: 'available',
              title: 'Profile',
              icon: 'gdtProfile',
              description:
                'Specifies how much a surface or edge can deviate from its ideal shape.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-gdt-profile'
                  ),
                },
              ],
            },
            {
              id: 'gdt-position',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'GDT Position', groupId: 'modeling' },
                }),
              status: 'available',
              title: 'Position',
              icon: 'gdtPosition',
              description:
                'Controls location tolerance of holes, pins, and other features.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-gdt-position'
                  ),
                },
              ],
            },
            {
              id: 'gdt-concentricity',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: {
                    name: 'GDT Concentricity',
                    groupId: 'modeling',
                  },
                }),
              status: 'available',
              title: 'Concentricity',
              icon: 'gdtConcentricity',
              description:
                'Controls how closely a feature axis aligns with a datum axis.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-gdt-concentricity'
                  ),
                },
              ],
            },
            {
              id: 'gdt-symmetry',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: {
                    name: 'GDT Symmetry',
                    groupId: 'modeling',
                  },
                }),
              status: 'available',
              title: 'Symmetry',
              icon: 'gdtSymmetry',
              description:
                'Controls how closely median points align with a datum center plane.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-gdt-symmetry'
                  ),
                },
              ],
            },
            {
              id: 'gdt-runout',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: {
                    name: 'GDT Runout',
                    groupId: 'modeling',
                  },
                }),
              status: 'available',
              title: 'Runout',
              icon: 'gdtRunout',
              description:
                'Controls how much a round feature may vary as it rotates around a datum axis.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-gdt-runout'
                  ),
                },
              ],
            },
            {
              id: 'gdt-angularity',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: {
                    name: 'GDT Angularity',
                    groupId: 'modeling',
                  },
                }),
              status: 'available',
              title: 'Angularity',
              icon: 'angle',
              description:
                'Specifies how much a feature may deviate from an orientation at a basic angle.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-gdt-angularity'
                  ),
                },
              ],
            },
            {
              id: 'gdt-perpendicularity',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: {
                    name: 'GDT Perpendicularity',
                    groupId: 'modeling',
                  },
                }),
              status: 'available',
              title: 'Perpendicularity',
              icon: 'perpendicular',
              description:
                'Specifies how perpendicular one feature must be to another.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-gdt-perpendicularity'
                  ),
                },
              ],
            },
            {
              id: 'gdt-parallelism',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: {
                    name: 'GDT Parallelism',
                    groupId: 'modeling',
                  },
                }),
              status: 'available',
              title: 'Parallelism',
              icon: 'parallel',
              description:
                'Specifies how parallel one feature must be to another.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-gdt-parallelism'
                  ),
                },
              ],
            },
            {
              id: 'gdt-distance',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'GDT Distance', groupId: 'modeling' },
                }),
              status: 'available',
              title: 'Distance',
              icon: 'dimension',
              description:
                'Adds distance annotations to edge lengths or between two entities.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-gdt-distance'
                  ),
                },
              ],
            },
            {
              id: 'gdt-annotation',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'GDT Annotation', groupId: 'modeling' },
                }),
              status: 'available',
              title: 'Annotation',
              icon: 'text',
              description:
                'Adds text annotations for manufacturing instructions or inspection requirements.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL(
                    '/docs/kcl-std/functions/std-gdt-annotation'
                  ),
                },
              ],
            },
            {
              id: 'gdt-note',
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: { name: 'GDT Note', groupId: 'modeling' },
                }),
              status: 'available',
              title: 'Note',
              icon: 'note',
              description:
                'Adds a free-floating note on a plane, not attached to any geometry.',
              links: [
                {
                  label: 'KCL docs',
                  url: withSiteBaseURL('/docs/kcl-std/functions/std-gdt-note'),
                },
              ],
            },
          ]),
        },
      ],
    },
    sketching: {
      check: (state) =>
        state.matches('Sketch') ||
        state.matches('Sketch no face') ||
        state.matches('animating to existing sketch') ||
        state.matches('animating to plane'),
      items: [
        {
          id: 'sketch-exit',
          command: TOOLBAR_COMMAND_IDS.sketching.exit,
          onClick: ({ modelingSend }) =>
            modelingSend({
              type: 'Cancel',
            }),
          icon: 'arrowShortLeft',
          status: 'available',
          title: 'Exit Sketch',
          showTitle: true,
          description: 'Exit the current sketch.',
          links: [],
        },
        'break',
        {
          id: 'line',
          command: TOOLBAR_COMMAND_IDS.sketching.line,
          onClick: ({ modelingState, modelingSend }) => {
            modelingSend({
              type: 'change tool',
              data: {
                tool: !modelingState.matches({ Sketch: 'Line tool' })
                  ? 'line'
                  : 'none',
              },
            })
          },
          icon: 'line',
          status: 'available',
          disabled: (state) => state.matches('Sketch no face'),
          title: 'Line',
          description: 'Start drawing straight lines.',
          links: [],
          isActive: (state) => state.matches({ Sketch: 'Line tool' }),
        },
        {
          id: 'arcs',
          array: [
            {
              id: 'three-point-arc',
              command: TOOLBAR_COMMAND_IDS.sketching.threePointArc,
              onClick: ({ modelingState, modelingSend }) =>
                modelingSend({
                  type: 'change tool',
                  data: {
                    tool: !modelingState.matches({
                      Sketch: 'Arc three point tool',
                    })
                      ? 'arcThreePoint'
                      : 'none',
                  },
                }),
              icon: 'arc',
              status: 'available',
              title: 'Three-Point Arc',
              showTitle: false,
              description: 'Draw a circular arc defined by three points.',
              links: [
                {
                  label: 'GitHub issue',
                  url: 'https://github.com/KittyCAD/modeling-app/issues/1659',
                },
              ],
              isActive: (state) =>
                state.matches({ Sketch: 'Arc three point tool' }),
            },
            {
              id: 'tangential-arc',
              command: TOOLBAR_COMMAND_IDS.sketching.tangentialArc,
              onClick: ({ modelingState, modelingSend }) =>
                modelingSend({
                  type: 'change tool',
                  data: {
                    tool: !modelingState.matches({
                      Sketch: 'Tangential arc to',
                    })
                      ? 'tangentialArc'
                      : 'none',
                  },
                }),
              icon: 'arc',
              status: 'available',
              disabled: (state) => {
                return (
                  (!isEditingExistingSketch({
                    sketchDetails: state.context.sketchDetails,
                    kclManager: state.context.kclManager,
                    wasmInstance: state.context.wasmInstance,
                  }) &&
                    !state.matches({ Sketch: 'Tangential arc to' })) ||
                  pipeHasCircle({
                    sketchDetails: state.context.sketchDetails,
                    kclManager: state.context.kclManager,
                    wasmInstance: state.context.wasmInstance,
                  })
                )
              },
              disabledReason: (state) => {
                return !isEditingExistingSketch({
                  sketchDetails: state.context.sketchDetails,
                  kclManager: state.context.kclManager,
                  wasmInstance: state.context.wasmInstance,
                }) && !state.matches({ Sketch: 'Tangential arc to' })
                  ? "Cannot start a tangential arc because there's no previous line to be tangential to.  Try drawing a line first or selecting an existing sketch to edit."
                  : undefined
              },
              title: 'Tangential Arc',
              description:
                'Start drawing an arc tangent to the current segment.',
              links: [],
              isActive: (state) =>
                state.matches({ Sketch: 'Tangential arc to' }),
            },
          ],
        },
        'break',
        {
          id: 'circles',
          array: [
            {
              id: 'circle-center',
              command: TOOLBAR_COMMAND_IDS.sketching.circleCenter,
              onClick: ({ modelingState, modelingSend }) =>
                modelingSend({
                  type: 'change tool',
                  data: {
                    tool: !modelingState.matches({ Sketch: 'Circle tool' })
                      ? 'circle'
                      : 'none',
                  },
                }),
              icon: 'circle',
              status: 'available',
              title: 'Center Circle',
              disabled: (state) => state.matches('Sketch no face'),
              isActive: (state) => state.matches({ Sketch: 'Circle tool' }),
              showTitle: false,
              description: 'Start drawing a circle from its center.',
              links: [],
            },
            {
              id: 'circle-three-points',
              command: TOOLBAR_COMMAND_IDS.sketching.circleThreePoints,
              onClick: ({ modelingState, modelingSend }) =>
                modelingSend({
                  type: 'change tool',
                  data: {
                    tool: !modelingState.matches({
                      Sketch: 'Circle three point tool',
                    })
                      ? 'circleThreePoint'
                      : 'none',
                  },
                }),
              icon: 'circle',
              status: 'available',
              title: '3-Point Circle',
              isActive: (state) =>
                state.matches({ Sketch: 'Circle three point tool' }),
              showTitle: false,
              description: 'Draw a circle defined by three points.',
              links: [],
            },
          ],
        },
        {
          id: 'rectangles',
          array: [
            {
              id: 'corner-rectangle',
              command: TOOLBAR_COMMAND_IDS.sketching.cornerRectangle,
              onClick: ({ modelingState, modelingSend }) =>
                modelingSend({
                  type: 'change tool',
                  data: {
                    tool: !modelingState.matches({ Sketch: 'Rectangle tool' })
                      ? 'rectangle'
                      : 'none',
                  },
                }),
              icon: 'rectangle',
              status: 'available',
              disabled: (state) => state.matches('Sketch no face'),
              title: 'Corner Rectangle',
              description: 'Start drawing a rectangle.',
              links: [],
              isActive: (state) => state.matches({ Sketch: 'Rectangle tool' }),
            },
            {
              id: 'center-rectangle',
              command: TOOLBAR_COMMAND_IDS.sketching.centerRectangle,
              onClick: ({ modelingState, modelingSend }) =>
                modelingSend({
                  type: 'change tool',
                  data: {
                    tool: !modelingState.matches({
                      Sketch: 'Center Rectangle tool',
                    })
                      ? 'center rectangle'
                      : 'none',
                  },
                }),
              icon: 'rectangle',
              status: 'available',
              disabled: (state) => state.matches('Sketch no face'),
              title: 'Center Rectangle',
              description: 'Start drawing a rectangle from its center.',
              links: [],
              isActive: (state) =>
                state.matches({ Sketch: 'Center Rectangle tool' }),
            },
          ],
        },
        {
          id: 'polygon',
          onClick: () => console.error('Polygon not yet implemented'),
          icon: 'polygon',
          status: 'kcl-only',
          title: 'Polygon',
          showTitle: false,
          description: 'Draw a polygon with a specified number of sides.',
          links: [
            {
              label: 'KCL docs',
              url: withSiteBaseURL(
                '/docs/kcl-std/functions/std-sketch-polygon'
              ),
            },
          ],
        },
        'break',
        {
          id: 'mirror',
          onClick: () => console.error('Mirror not yet implemented'),
          icon: 'mirror',
          status: 'kcl-only',
          title: 'Mirror',
          showTitle: false,
          description: 'Mirror sketch entities about a line or axis.',
          links: [
            {
              label: 'KCL docs',
              url: withSiteBaseURL(
                '/docs/kcl-std/functions/std-transform-mirror2d'
              ),
            },
          ],
        },
        {
          id: 'constraints',
          array: [
            {
              id: 'constraint-length',
              disabled: (state, wasmInstance) =>
                !(
                  state.matches({ Sketch: 'SketchIdle' }) &&
                  state.can({
                    type: 'Constrain length',
                    data: {
                      selection: state.context.selectionRanges,
                      // dummy data is okay for checking if the constrain is possible
                      length: {
                        valueAst: createLiteral(1, wasmInstance),
                        valueText: '1',
                        valueCalculated: '1',
                      },
                    },
                  })
                ),
              onClick: () =>
                commands.send({
                  type: 'Find and select command',
                  data: {
                    name: 'Constrain length',
                    groupId: 'modeling',
                  },
                }),
              icon: 'dimension',
              status: 'available',
              title: 'Length',
              showTitle: false,
              description: 'Constrain the length of a straight segment.',
              extraInfo: constraintsExtraInfo,
              links: [],
            },
            {
              id: 'constraint-angle',
              disabled: (state) =>
                !(
                  state.matches({ Sketch: 'SketchIdle' }) &&
                  state.can({ type: 'Constrain angle' })
                ),
              onClick: ({ modelingSend }) =>
                modelingSend({ type: 'Constrain angle' }),
              status: 'available',
              title: 'Angle',
              showTitle: false,
              description: 'Constrain the angle between two segments.',
              extraInfo: constraintsExtraInfo,
              links: [],
            },
            {
              id: 'constraint-vertical',
              disabled: (state) =>
                !(
                  state.matches({ Sketch: 'SketchIdle' }) &&
                  state.can({ type: 'Make segment vertical' })
                ),
              onClick: ({ modelingSend }) =>
                modelingSend({ type: 'Make segment vertical' }),
              status: 'available',
              title: 'Vertical',
              showTitle: false,
              description:
                'Constrain a straight segment to be vertical relative to the sketch.',
              extraInfo: constraintsExtraInfo,
              links: [],
            },
            {
              id: 'constraint-horizontal',
              disabled: (state) =>
                !(
                  state.matches({ Sketch: 'SketchIdle' }) &&
                  state.can({ type: 'Make segment horizontal' })
                ),
              onClick: ({ modelingSend }) =>
                modelingSend({ type: 'Make segment horizontal' }),
              status: 'available',
              title: 'Horizontal',
              showTitle: false,
              description:
                'Constrain a straight segment to be horizontal relative to the sketch.',
              extraInfo: constraintsExtraInfo,
              links: [],
            },
            {
              id: 'constraint-parallel',
              disabled: (state) =>
                !(
                  state.matches({ Sketch: 'SketchIdle' }) &&
                  state.can({ type: 'Constrain parallel' })
                ),
              onClick: ({ modelingSend }) =>
                modelingSend({ type: 'Constrain parallel' }),
              status: 'available',
              title: 'Parallel',
              showTitle: false,
              description: 'Constrain two segments to be parallel.',
              extraInfo: constraintsExtraInfo,
              links: [],
            },
            {
              id: 'constraint-equal-length',
              disabled: (state) =>
                !(
                  state.matches({ Sketch: 'SketchIdle' }) &&
                  state.can({ type: 'Constrain equal length' })
                ),
              onClick: ({ modelingSend }) =>
                modelingSend({ type: 'Constrain equal length' }),
              status: 'available',
              title: 'Equal',
              showTitle: false,
              description:
                'Constrain two or more segments to have equal length.',
              extraInfo: constraintsExtraInfo,
              links: [],
            },
            {
              id: 'constraint-horizontal-distance',
              disabled: (state) =>
                !(
                  state.matches({ Sketch: 'SketchIdle' }) &&
                  state.can({ type: 'Constrain horizontal distance' })
                ),
              onClick: ({ modelingSend }) =>
                modelingSend({ type: 'Constrain horizontal distance' }),
              status: 'available',
              title: 'Horizontal Distance',
              showTitle: false,
              description:
                'Constrain the horizontal distance between two points.',
              extraInfo: constraintsExtraInfo,
              links: [],
            },
            {
              id: 'constraint-vertical-distance',
              disabled: (state) =>
                !(
                  state.matches({ Sketch: 'SketchIdle' }) &&
                  state.can({ type: 'Constrain vertical distance' })
                ),
              onClick: ({ modelingSend }) =>
                modelingSend({ type: 'Constrain vertical distance' }),
              status: 'available',
              title: 'Vertical Distance',
              showTitle: false,
              description:
                'Constrain the vertical distance between two points.',
              extraInfo: constraintsExtraInfo,
              links: [],
            },
            {
              id: 'constraint-absolute-x',
              disabled: (state) =>
                !(
                  state.matches({ Sketch: 'SketchIdle' }) &&
                  state.can({ type: 'Constrain ABS X' })
                ),
              onClick: ({ modelingSend }) =>
                modelingSend({ type: 'Constrain ABS X' }),
              status: 'available',
              title: 'Absolute X',
              showTitle: false,
              description: 'Constrain the x-coordinate of a point.',
              extraInfo: constraintsExtraInfo,
              links: [],
            },
            {
              id: 'constraint-absolute-y',
              disabled: (state) =>
                !(
                  state.matches({ Sketch: 'SketchIdle' }) &&
                  state.can({ type: 'Constrain ABS Y' })
                ),
              onClick: ({ modelingSend }) =>
                modelingSend({ type: 'Constrain ABS Y' }),
              status: 'available',
              title: 'Absolute Y',
              showTitle: false,
              description: 'Constrain the y-coordinate of a point.',
              extraInfo: constraintsExtraInfo,
              links: [],
            },
            {
              id: 'constraint-perpendicular-distance',
              disabled: (state) =>
                !(
                  state.matches({ Sketch: 'SketchIdle' }) &&
                  state.can({ type: 'Constrain perpendicular distance' })
                ),
              onClick: ({ modelingSend }) =>
                modelingSend({ type: 'Constrain perpendicular distance' }),
              status: 'available',
              title: 'Perpendicular Distance',
              showTitle: false,
              description:
                'Constrain the perpendicular distance between two segments.',
              extraInfo: constraintsExtraInfo,
              links: [],
            },
            {
              id: 'constraint-align-horizontal',
              disabled: (state) =>
                !(
                  state.matches({ Sketch: 'SketchIdle' }) &&
                  state.can({ type: 'Constrain horizontally align' })
                ),
              onClick: ({ modelingSend }) =>
                modelingSend({ type: 'Constrain horizontally align' }),
              status: 'available',
              title: 'Horizontally Align',
              showTitle: false,
              description:
                'Align the ends of two or more segments horizontally.',
              extraInfo: constraintsExtraInfo,
              links: [],
            },
            {
              id: 'constraint-align-vertical',
              disabled: (state) =>
                !(
                  state.matches({ Sketch: 'SketchIdle' }) &&
                  state.can({ type: 'Constrain vertically align' })
                ),
              onClick: ({ modelingSend }) =>
                modelingSend({ type: 'Constrain vertically align' }),
              status: 'available',
              title: 'Vertically Align',
              showTitle: false,
              description: 'Align the ends of two or more segments vertically.',
              extraInfo: constraintsExtraInfo,
              links: [],
            },
            {
              id: 'snap-to-x',
              disabled: (state) =>
                !(
                  state.matches({ Sketch: 'SketchIdle' }) &&
                  state.can({ type: 'Constrain snap to X' })
                ),
              onClick: ({ modelingSend }) =>
                modelingSend({ type: 'Constrain snap to X' }),
              status: 'available',
              title: 'Snap to X',
              showTitle: false,
              description: 'Snap a point to an x-coordinate.',
              extraInfo: constraintsExtraInfo,
              links: [],
            },
            {
              id: 'snap-to-y',
              disabled: (state) =>
                !(
                  state.matches({ Sketch: 'SketchIdle' }) &&
                  state.can({ type: 'Constrain snap to Y' })
                ),
              onClick: ({ modelingSend }) =>
                modelingSend({ type: 'Constrain snap to Y' }),
              status: 'available',
              title: 'Snap to Y',
              showTitle: false,
              description: 'Snap a point to a y-coordinate.',
              extraInfo: constraintsExtraInfo,
              links: [],
            },
            {
              id: 'constraint-remove',
              disabled: (state) =>
                !(
                  state.matches({ Sketch: 'SketchIdle' }) &&
                  state.can({ type: 'Constrain remove constraints' })
                ),
              onClick: ({ modelingSend }) =>
                modelingSend({ type: 'Constrain remove constraints' }),
              status: 'available',
              title: 'Remove Constraints',
              showTitle: false,
              description: 'Remove all constraints from the segment.',
              links: [],
            },
          ],
        },
      ],
    },
    sketchSolve: {
      check: (state) => state.matches('sketchSolveMode'),
      items: [
        {
          id: 'sketch-exit',
          command: TOOLBAR_COMMAND_IDS.sketchSolve.exit,
          onClick: ({ modelingSend }) =>
            modelingSend({
              type: 'Exit sketch',
            }),
          icon: 'arrowShortLeft',
          status: 'available',
          title: 'Exit Sketch',
          showTitle: true,
          description: 'Exit the current sketch.',
          links: [],
        },
        'break',
        {
          id: 'line',
          command: TOOLBAR_COMMAND_IDS.sketchSolve.line,
          onClick: ({ modelingSend, isActive }) =>
            isActive
              ? modelingSend({
                  type: 'unequip tool',
                })
              : modelingSend({
                  type: 'equip tool',
                  data: { tool: 'lineTool' },
                }),
          icon: 'line',
          status: 'available',
          title: 'Line',
          description: 'Start drawing straight lines.',
          links: [],
          isActive: (state) =>
            state.matches('sketchSolveMode') &&
            state.context.sketchSolveToolName === 'lineTool',
        },
        {
          id: 'point',
          command: TOOLBAR_COMMAND_IDS.sketchSolve.point,
          onClick: ({ modelingSend, isActive }) =>
            isActive
              ? modelingSend({
                  type: 'unequip tool',
                })
              : modelingSend({
                  type: 'equip tool',
                  data: { tool: 'pointTool' },
                }),
          icon: 'oneDot',
          status: 'available',
          title: 'Point',
          description: 'Start drawing straight points.',
          links: [],
          isActive: (state) =>
            state.matches('sketchSolveMode') &&
            state.context.sketchSolveToolName === 'pointTool',
        },
        splineToolbarItem,
        {
          id: 'circle-center',
          command: TOOLBAR_COMMAND_IDS.sketchSolve.circleCenter,
          onClick: ({ modelingSend, isActive }) =>
            isActive
              ? modelingSend({
                  type: 'unequip tool',
                })
              : modelingSend({
                  type: 'equip tool',
                  data: { tool: 'circleTool' },
                }),
          icon: 'circle',
          status: 'available',
          title: 'Center Circle',
          description: 'Draw a circle from a center point and radius.',
          links: [],
          isActive: (state) =>
            state.matches('sketchSolveMode') &&
            state.context.sketchSolveToolName === 'circleTool',
        },
        {
          id: 'arcs',
          array: [
            {
              id: 'center-arc',
              command: TOOLBAR_COMMAND_IDS.sketchSolve.centerArc,
              onClick: ({ modelingSend, isActive }) =>
                isActive
                  ? modelingSend({
                      type: 'unequip tool',
                    })
                  : modelingSend({
                      type: 'equip tool',
                      data: { tool: 'centerArcTool' },
                    }),
              icon: 'arcCenter',
              status: 'available',
              title: 'Center Arc',
              description: 'Draw an arc by center and two endpoints.',
              links: [],
              isActive: (state) =>
                state.matches('sketchSolveMode') &&
                state.context.sketchSolveToolName === 'centerArcTool',
            },
            {
              id: 'three-point-arc',
              command: TOOLBAR_COMMAND_IDS.sketchSolve.threePointArc,
              onClick: ({ modelingSend, isActive }) =>
                isActive
                  ? modelingSend({
                      type: 'unequip tool',
                    })
                  : modelingSend({
                      type: 'equip tool',
                      data: { tool: 'threePointArcTool' },
                    }),
              icon: 'arc',
              status: 'available',
              title: '3-Point Arc',
              description: 'Draw an arc from start, end, and a third point.',
              links: [],
              isActive: (state) =>
                state.matches('sketchSolveMode') &&
                state.context.sketchSolveToolName === 'threePointArcTool',
            },
            {
              id: 'tangential-arc',
              command: TOOLBAR_COMMAND_IDS.sketchSolve.tangentialArc,
              onClick: ({ modelingSend, isActive }) =>
                isActive
                  ? modelingSend({
                      type: 'unequip tool',
                    })
                  : modelingSend({
                      type: 'equip tool',
                      data: { tool: 'tangentialArcTool' },
                    }),
              icon: 'tangent',
              status: 'available',
              title: 'Tangential Arc',
              description: 'Draw an arc tangent to an existing line endpoint.',
              links: [],
              isActive: (state) =>
                state.matches('sketchSolveMode') &&
                state.context.sketchSolveToolName === 'tangentialArcTool',
            },
          ],
        },
        {
          id: 'trim',
          command: TOOLBAR_COMMAND_IDS.sketchSolve.trim,
          onClick: ({ modelingSend, isActive }) =>
            isActive
              ? modelingSend({ type: 'unequip tool' })
              : modelingSend({
                  type: 'equip tool',
                  data: { tool: 'trimTool' },
                }),
          icon: 'trimTool',
          status: 'available',
          title: 'Trim',
          description:
            'Draw a trimming line through parts of segments to be removed.',
          links: [],
          isActive: (state) =>
            state.matches('sketchSolveMode') &&
            state.context.sketchSolveToolName === 'trimTool',
        },
        {
          id: 'rectangles',
          array: [
            {
              id: 'corner-rectangle',
              command: TOOLBAR_COMMAND_IDS.sketchSolve.cornerRectangle,
              onClick: ({ modelingSend, isActive }) =>
                isActive
                  ? modelingSend({
                      type: 'unequip tool',
                    })
                  : modelingSend({
                      type: 'equip tool',
                      data: { tool: 'cornerRectTool' },
                    }),
              icon: 'rectangle',
              status: 'available',
              title: 'Corner Rectangle',
              description: 'Start drawing a rectangle.',
              links: [],
              isActive: (state) =>
                state.matches('sketchSolveMode') &&
                state.context.sketchSolveToolName === 'cornerRectTool',
            },
            {
              id: 'center-rectangle',
              command: TOOLBAR_COMMAND_IDS.sketchSolve.centerRectangle,
              onClick: ({ modelingSend, isActive }) =>
                isActive
                  ? modelingSend({
                      type: 'unequip tool',
                    })
                  : modelingSend({
                      type: 'equip tool',
                      data: { tool: 'centerRectTool' },
                    }),
              icon: 'rectangleCenter',
              status: 'available',
              title: 'Center Rectangle',
              description: 'Start drawing a rectangle from its center.',
              links: [],
              isActive: (state) =>
                state.matches('sketchSolveMode') &&
                state.context.sketchSolveToolName === 'centerRectTool',
            },
            {
              id: 'angled-rectangle',
              command: TOOLBAR_COMMAND_IDS.sketchSolve.angledRectangle,
              onClick: ({ modelingSend, isActive }) =>
                isActive
                  ? modelingSend({
                      type: 'unequip tool',
                    })
                  : modelingSend({
                      type: 'equip tool',
                      data: { tool: 'angledRectTool' },
                    }),
              icon: 'rectangleAngled',
              status: 'available',
              title: 'Angled Rectangle',
              description: 'Draw a rotated rectangle with three clicks.',
              links: [],
              isActive: (state) =>
                state.matches('sketchSolveMode') &&
                state.context.sketchSolveToolName === 'angledRectTool',
            },
          ],
        },
        'break',
        {
          id: 'constraints',
          array: sketchSolveConstraintItems,
          display: 'recent',
          visibleItemCount: 3,
          defaultVisibleItemIds: ['coincident', 'Tangent', 'Parallel'],
        },
        {
          id: 'Dimension',
          command: TOOLBAR_COMMAND_IDS.sketchSolve.dimension,
          onClick: ({ modelingSend, keepSelection }) =>
            modelingSend({
              type: 'Dimension',
              keepSelection,
            }),
          icon: 'dimension',
          status: 'available',
          title: 'Dimension',
          description:
            'Constrain distance between points, length of lines, or radius of arcs.',
          extraInfo: constraintsExtraInfo,
          links: [],
          isActive: (state) => false,
        },
        {
          id: 'HorizontalDistance',
          command: TOOLBAR_COMMAND_IDS.sketchSolve.horizontalDistance,
          onClick: ({ modelingSend, keepSelection }) =>
            modelingSend({
              type: 'HorizontalDistance',
              keepSelection,
            }),
          icon: 'horizontalDimension',
          status: 'available',
          title: 'Horizontal Distance',
          description: 'Constrain horizontal distance between two points.',
          extraInfo: constraintsExtraInfo,
          links: [],
          isActive: (state) => false,
        },
        {
          id: 'VerticalDistance',
          command: TOOLBAR_COMMAND_IDS.sketchSolve.verticalDistance,
          onClick: ({ modelingSend, keepSelection }) =>
            modelingSend({
              type: 'VerticalDistance',
              keepSelection,
            }),
          icon: 'verticalDimension',
          status: 'available',
          title: 'Vertical Distance',
          description: 'Constrain vertical distance between two points.',
          extraInfo: constraintsExtraInfo,
          links: [],
          isActive: (state) => false,
        },
        {
          id: 'construction',
          command: TOOLBAR_COMMAND_IDS.sketchSolve.construction,
          onClick: ({ modelingSend, keepSelection }) =>
            modelingSend({
              type: 'construction',
              keepSelection,
            }),
          icon: 'construction',
          status: 'available',
          title: 'Construction',
          description: 'Toggle construction geometry on selected segments.',
          links: [],
          isActive: (state) => false,
        },
      ],
    },
  }

  return filterExperimentalToolbarConfig(
    toolbarConfig,
    showExperimentalFeatures
  )
}

function getSelectedSketchTarget(selectionRanges: Selections): {
  id: string
  title: string
} | null {
  const defaultPlane = getSelectedDefaultPlane(selectionRanges)
  if (defaultPlane) {
    return {
      id: defaultPlane.id,
      title: `Start Sketch on ${defaultPlane.name.toUpperCase()}`,
    }
  }

  const id = getSelectedSketchTargetId(selectionRanges)
  if (!id) return null

  return {
    id,
    title:
      getSelectedPlaneId(selectionRanges) === id
        ? 'Start Sketch on plane'
        : 'Start Sketch on face',
  }
}

function getSelectedSketchIconColor(
  selectionRanges: Selections
): string | undefined {
  const defaultPlane = getSelectedDefaultPlane(selectionRanges)
  if (defaultPlane) {
    switch (defaultPlane.name.toLowerCase()) {
      case 'xy':
        return SKETCH_DEFAULT_PLANE_XY
      case 'xz':
        return SKETCH_DEFAULT_PLANE_XZ
      case 'yz':
        return SKETCH_DEFAULT_PLANE_YZ
    }
  }

  return getSelectedSketchTargetId(selectionRanges)
    ? `rgb(${SKETCH_SELECTION_RGB_STR})`
    : undefined
}

export const useToolbarConfig = () => {
  const { commands, userFeatures } = useApp()
  const showExperimentalFeatures = userFeatures.useHas(
    EXPERIMENTAL_POINT_AND_CLICK_FLAG,
    false
  )

  return useMemo<Record<ToolbarModeName, ToolbarMode>>(
    () => buildToolbarConfig(commands, { showExperimentalFeatures }),
    [commands, showExperimentalFeatures]
  )
}

/**
 * Derives a map of sketchSolve tool names to their icon names from the toolbar config.
 * This ensures a single source of truth for tool-to-icon mappings.
 * Extracts tool names by parsing the isActive function which references state.context.sketchSolveToolName.
 */
export function getSketchSolveToolIconMap(
  toolbarConfig: Record<ToolbarModeName, ToolbarMode>
): Record<string, CustomIconName> {
  const map: Record<string, CustomIconName> = {}
  const items = toolbarConfig.sketchSolve.items
  collectItems(items, map)
  return map
}

function collectItems(
  items: ToolbarMode['items'],
  map: Record<string, CustomIconName>
) {
  for (const item of items) {
    // Skip 'break' strings
    if (typeof item === 'string') continue

    // dropdowns, eg. rectangles
    if ('array' in item) {
      collectItems(item.array, map)
      continue
    }

    // Now TypeScript knows item is ToolbarItem
    // Only process items that have an icon and an isActive function (which indicates it's a tool)
    if (item.icon && item.isActive) {
      if (item.sketchSolveToolName) {
        map[item.sketchSolveToolName] = item.icon
        continue
      }

      // Extract tool name from isActive function string representation
      // The isActive function references the tool name like: state.context.sketchSolveToolName === 'toolName'
      const isActiveStr = item.isActive.toString()
      const toolNameMatch = isActiveStr.match(
        /sketchSolveToolName\s*===\s*['"]([^'"]+)['"]/
      )
      if (toolNameMatch && toolNameMatch[1]) {
        map[toolNameMatch[1]] = item.icon
      }
    }
  }
}
