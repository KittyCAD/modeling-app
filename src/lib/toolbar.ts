import type { CustomIconName } from '@src/components/CustomIcon'
import { createLiteral } from '@src/lang/create'
import {
  getSelectedPlaneId,
  getSelectedSketchTarget as getSelectedSketchTargetId,
} from '@src/lang/queryAst'
import { useApp } from '@src/lib/boot'
import { modelingMachineCommandConfig } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import {
  modelingStdLibCommandName,
  modelingStdLibCommandStatus,
  type ModelingStdLibCommandName,
} from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import {
  STD_LIB_COMMANDS,
  type StdLibCommandName,
} from '@src/lib/commandBarConfigs/modelingCommandStdLibCommands'
import type { Command } from '@src/lib/commandTypes'
import { commandKey } from '@src/lib/commandUtils'
import {
  EXPERIMENTAL_POINT_AND_CLICK_FLAG,
  LEGACY_SKETCH_MODE_REMOVED_MESSAGE,
  SKETCH_DEFAULT_PLANE_XY,
  SKETCH_DEFAULT_PLANE_XZ,
  SKETCH_DEFAULT_PLANE_YZ,
  SKETCH_SELECTION_RGB_STR,
} from '@src/lib/constants'
import type { HotkeySequence } from '@src/lib/hotkeys'
import { isDesktop } from '@src/lib/isDesktop'
import { selectSketchPlane } from '@src/lib/selectSketchPlane'
import { getSelectedDefaultPlane } from '@src/lib/selections'
import { isArray } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import type { modelingMachine } from '@src/machines/modelingMachine'
import {
  isEditingExistingSketch,
  pipeHasCircle,
} from '@src/machines/modelingMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { constraintToolMetadata } from '@src/machines/sketchSolve/constraints/constraintMetadata'
import { isSketchBlockSelected } from '@src/machines/sketchSolve/sketchSolveImpl'
import type { ConstraintToolName } from '@src/machines/sketchSolve/tools/constraintToolModel'
import {
  MODE_MODELING_KEYMAP_SCOPE,
  MODE_SKETCH_NO_FACE_KEYMAP_SCOPE,
  MODE_SKETCH_SOLVE_KEYMAP_SCOPE,
  MODE_SKETCHING_KEYMAP_SCOPE,
} from '@src/registry/contracts/keymap'
import { TOOLBAR_COMMAND_IDS } from '@src/registry/extensions/commands/toolbarCommandIds'
import { useMemo } from 'react'
import type { EventFrom, StateFrom } from 'xstate'

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
    wasmInstance: ModuleType,
    props?: ToolbarItemCallbackProps
  ) => boolean
  title: string | ((props: ToolbarItemCallbackProps) => string)
  tooltipTitle?: string | ((props: ToolbarItemCallbackProps) => string)
  showTitle?: boolean
  description?: string
  extraInfo?: string
  links: { label: string; url: string }[]
  isActive?: (state: StateFrom<typeof modelingMachine>) => boolean
  disabledReason?:
    | string
    | ((
        state: StateFrom<typeof modelingMachine>,
        props?: ToolbarItemCallbackProps
      ) => string | undefined)
}

type ToolbarConfig = Record<ToolbarModeName, ToolbarMode>

export function getToolbarItemDescription(
  item: Pick<ToolbarItem, 'command' | 'description'>,
  commands: readonly Command[]
) {
  return (
    commands.find((command) => commandKey(command) === item.command)
      ?.description ??
    item.description ??
    ''
  )
}

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
  | 'disabled'
  | 'isActive'
  | 'title'
  | 'tooltipTitle'
  | 'iconColor'
  | 'description'
> & {
  title: string
  description: string
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
  'id' | 'command' | 'icon'
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
}: ConstraintToolbarItemConfig): ToolbarItem {
  const metadata = constraintToolMetadata[toolName]

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
    title: metadata.title,
    description: metadata.description,
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
  }),
  createSketchSolveConstraintDropdownItem({
    id: 'midpoint',
    command: TOOLBAR_COMMAND_IDS.sketchSolve.midpoint,
    toolName: 'midpointConstraintTool',
    icon: 'midpoint',
  }),
  createSketchSolveConstraintDropdownItem({
    id: 'Tangent',
    command: TOOLBAR_COMMAND_IDS.sketchSolve.tangent,
    toolName: 'tangentConstraintTool',
    icon: 'tangent',
  }),
  createSketchSolveConstraintDropdownItem({
    id: 'Parallel',
    command: TOOLBAR_COMMAND_IDS.sketchSolve.parallel,
    toolName: 'parallelConstraintTool',
    icon: 'parallel',
  }),
  createSketchSolveConstraintDropdownItem({
    id: 'Perpendicular',
    command: TOOLBAR_COMMAND_IDS.sketchSolve.perpendicular,
    toolName: 'perpendicularConstraintTool',
    icon: 'perpendicular',
  }),
  createSketchSolveConstraintDropdownItem({
    id: 'equalLength',
    command: TOOLBAR_COMMAND_IDS.sketchSolve.equal,
    toolName: 'equalLengthConstraintTool',
    icon: 'equal',
  }),
  createSketchSolveConstraintDropdownItem({
    id: 'Symmetric',
    command: TOOLBAR_COMMAND_IDS.sketchSolve.symmetric,
    toolName: 'symmetricConstraintTool',
    icon: 'symmetric',
  }),
  createSketchSolveConstraintDropdownItem({
    id: 'vertical',
    command: TOOLBAR_COMMAND_IDS.sketchSolve.vertical,
    toolName: 'verticalConstraintTool',
    icon: 'vertical',
  }),
  createSketchSolveConstraintDropdownItem({
    id: 'Horizontal',
    command: TOOLBAR_COMMAND_IDS.sketchSolve.horizontal,
    toolName: 'horizontalConstraintTool',
    icon: 'horizontal',
  }),
  createSketchSolveConstraintDropdownItem({
    id: 'Fixed',
    command: TOOLBAR_COMMAND_IDS.sketchSolve.fixed,
    toolName: 'fixedConstraintTool',
    icon: 'fix',
  }),
]

type ToolbarCommands = Pick<ReturnType<typeof useApp>['commands'], 'send'>

export function isLegacySketchEditRequest({
  editorHasFocus,
  sketchPathId,
  modelingState,
}: Pick<
  ToolbarItemCallbackProps,
  'editorHasFocus' | 'sketchPathId' | 'modelingState'
>): boolean {
  return (
    Boolean(editorHasFocus && sketchPathId) &&
    !isSketchBlockSelected(
      modelingState.context.selectionRanges,
      modelingState.context.kclManager.artifactGraph
    )
  )
}

function stdLibDocsLink(stdLibName: StdLibCommandName, label = 'KCL docs') {
  const { qualName } = STD_LIB_COMMANDS[stdLibName]
  return {
    label,
    url: withSiteBaseURL(
      `/docs/kcl-std/functions/${qualName.replaceAll('::', '-')}`
    ),
  }
}

export function buildToolbarConfig(
  commands: ToolbarCommands,
  {
    showExperimentalFeatures = false,
  }: {
    showExperimentalFeatures?: boolean
  } = {}
): ToolbarConfig {
  const modelingCommand = (
    name: ModelingStdLibCommandName,
    {
      title,
      icon,
      extraLinks = [],
      ...item
    }: Pick<ToolbarItem, 'id' | 'icon' | 'extraInfo'> & {
      title?: string
      extraLinks?: ToolbarItem['links']
    }
  ): ToolbarItem & { title: string } => {
    const stdLibName = modelingStdLibCommandName(name)
    const config = modelingMachineCommandConfig[name]
    const commandConfig = isArray(config) ? undefined : config
    const status = commandConfig?.status ?? modelingStdLibCommandStatus(name)
    return {
      ...item,
      command: `modeling:${name}`,
      title: title ?? commandConfig?.displayName ?? name,
      icon: icon ?? commandConfig?.icon,
      status: status === 'experimental' ? 'experimental' : 'available',
      links: [stdLibDocsLink(stdLibName), ...extraLinks],
      onClick: () =>
        commands.send({
          type: 'Find and select command',
          data: { name, groupId: 'modeling' },
        }),
    }
  }

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
          onClick: (props) => {
            const {
              modelingSend,
              modelingState,
              sketchPathId,
              editorHasFocus,
            } = props
            const isSketchBlock = isSketchBlockSelected(
              modelingState.context.selectionRanges,
              modelingState.context.kclManager.artifactGraph
            )
            const selectedSketchTarget =
              getSelectedSketchTarget(modelingState.context.selectionRanges)
                ?.id ?? null

            if (isLegacySketchEditRequest(props)) {
              return
            }

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
          disabled: (_state, _wasmInstance, props) =>
            Boolean(props && isLegacySketchEditRequest(props)),
          disabledReason: (_state, props) =>
            props && isLegacySketchEditRequest(props)
              ? LEGACY_SKETCH_MODE_REMOVED_MESSAGE
              : undefined,
          title: ({ editorHasFocus, sketchPathId, modelingState }) => {
            const isSketchBlock = isSketchBlockSelected(
              modelingState.context.selectionRanges,
              modelingState.context.kclManager.artifactGraph
            )

            if ((editorHasFocus && sketchPathId) || isSketchBlock) {
              return 'Edit Sketch'
            }

            return 'Start Sketch'
          },
          tooltipTitle: ({ editorHasFocus, sketchPathId, modelingState }) => {
            const isSketchBlock = isSketchBlockSelected(
              modelingState.context.selectionRanges,
              modelingState.context.kclManager.artifactGraph
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
              url: withSiteBaseURL('/docs/kcl-lang/sketches'),
            },
          ],
        },
        'break',
        modelingCommand('Extrude', {
          id: 'extrude',
        }),
        modelingCommand('Sweep', {
          id: 'sweep',
        }),
        modelingCommand('Loft', {
          id: 'loft',
        }),
        modelingCommand('Revolve', {
          id: 'revolve',
          extraLinks: [
            {
              label: 'KCL example',
              url: withSiteBaseURL('/docs/kcl-samples/ball-bearing'),
            },
          ],
        }),
        'break',
        modelingCommand('Fillet', {
          id: 'fillet3d',
        }),
        modelingCommand('Chamfer', {
          id: 'chamfer3d',
        }),
        modelingCommand('Shell', {
          id: 'shell',
        }),
        modelingCommand('Hole', {
          id: 'hole',
        }),
        'break',
        {
          id: 'booleans',
          array: [
            modelingCommand('Boolean Union', {
              id: 'boolean-union',
              title: 'Union',
            }),
            modelingCommand('Boolean Subtract', {
              id: 'boolean-subtract',
              title: 'Subtract',
            }),
            modelingCommand('Boolean Intersect', {
              id: 'boolean-intersect',
              title: 'Intersect',
            }),
          ],
        },
        modelingCommand('Boolean Split', {
          id: 'split',
          title: 'Split',
        }),
        {
          id: 'surface',
          array: [
            modelingCommand('Blend', {
              id: 'blend-surface',
            }),
            modelingCommand('Flip Surface', {
              id: 'flip-surface',
            }),
            modelingCommand('Join Surfaces', {
              id: 'join-surfaces',
            }),
            modelingCommand('Delete Face', {
              id: 'delete-face',
            }),
          ],
        },
        'break',
        {
          id: 'planes',
          array: [
            modelingCommand('Offset plane', {
              id: 'plane-offset',
            }),
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
        modelingCommand('Helix', {
          id: 'helix',
        }),
        {
          id: 'gears',
          array: [
            modelingCommand('Helical Gear', {
              id: 'gear-helical',
            }),
            modelingCommand('Spur Gear', {
              id: 'gear-spur',
            }),
            modelingCommand('Herringbone Gear', {
              id: 'gear-herringbone',
            }),
            modelingCommand('Ring Gear', {
              id: 'gear-ring',
            }),
          ],
        },
        'break',
        {
          id: 'insert',
          command: 'code:Insert',
          onClick: () =>
            commands.send({
              type: 'Find and select command',
              data: { name: 'Import', groupId: 'code' },
            }),
          icon: 'import',
          status: 'available',
          disabled: () => !isDesktop(),
          title: 'Import',
          description: 'Import from a file in the current project directory.',
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
            modelingCommand('Translate', {
              id: 'translate',
            }),
            modelingCommand('Rotate', {
              id: 'rotate',
            }),
            modelingCommand('Scale', {
              id: 'scale',
            }),
            modelingCommand('Clone', {
              id: 'clone',
            }),
            modelingCommand('Mirror 3D', {
              id: 'mirror3d',
            }),
            modelingCommand('Appearance', {
              id: 'appearance',
              icon: 'text',
            }),
            modelingCommand('Delete', {
              id: 'delete',
            }),
          ],
        },
        {
          id: 'pattern',
          array: [
            modelingCommand('Pattern Circular 3D', {
              id: 'pattern-circular-3d',
              title: 'Circular Pattern',
            }),
            modelingCommand('Pattern Linear 3D', {
              id: 'pattern-linear-3d',
              title: 'Linear Pattern',
            }),
          ],
        },
        'break',
        {
          id: 'gdt',
          array: sortToolbarItemsByTitle([
            modelingCommand('GDT Flatness', {
              id: 'gdt-flatness',
              title: 'Flatness',
            }),
            modelingCommand('GDT Straightness', {
              id: 'gdt-straightness',
              title: 'Straightness',
            }),
            modelingCommand('GDT Circularity', {
              id: 'gdt-circularity',
              title: 'Circularity',
            }),
            modelingCommand('GDT Cylindricity', {
              id: 'gdt-cylindricity',
              title: 'Cylindricity',
            }),
            modelingCommand('GDT Datum', {
              id: 'gdt-datum',
              title: 'Datum',
            }),
            modelingCommand('GDT Profile', {
              id: 'gdt-profile',
              title: 'Profile',
              extraLinks: [
                stdLibDocsLink('gdt::profileSurface', 'KCL docs (faces)'),
              ],
            }),
            modelingCommand('GDT Position', {
              id: 'gdt-position',
              title: 'Position',
            }),
            modelingCommand('GDT Concentricity', {
              id: 'gdt-concentricity',
              title: 'Concentricity',
            }),
            modelingCommand('GDT Symmetry', {
              id: 'gdt-symmetry',
              title: 'Symmetry',
            }),
            modelingCommand('GDT Runout', {
              id: 'gdt-runout',
              title: 'Runout',
            }),
            modelingCommand('GDT Angularity', {
              id: 'gdt-angularity',
              title: 'Angularity',
            }),
            modelingCommand('GDT Perpendicularity', {
              id: 'gdt-perpendicularity',
              title: 'Perpendicularity',
            }),
            modelingCommand('GDT Parallelism', {
              id: 'gdt-parallelism',
              title: 'Parallelism',
            }),
            modelingCommand('GDT Distance', {
              id: 'gdt-distance',
              title: 'Distance',
            }),
            modelingCommand('GDT Annotation', {
              id: 'gdt-annotation',
              title: 'Annotation',
            }),
            modelingCommand('GDT Note', {
              id: 'gdt-note',
              title: 'Note',
            }),
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
              url: withSiteBaseURL('/docs/kcl-lang/sketches'),
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
          onClick: ({ modelingSend, isActive, keepSelection }) =>
            isActive
              ? modelingSend({
                  type: 'unequip tool',
                })
              : modelingSend({
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
          isActive: (state) =>
            state.matches('sketchSolveMode') &&
            state.context.sketchSolveToolName === 'dimensionTool',
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
    () =>
      buildToolbarConfig(commands, {
        showExperimentalFeatures,
      }),
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
