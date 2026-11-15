import {
  ToolbarView,
  type ToolbarViewEntry,
  type ToolbarViewItem,
} from '@src/components/Toolbar/ToolbarView'
import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import type { useAppState } from '@src/AppState'
import type { useModelingContext } from '@src/hooks/useModelingContext'
import type { useNetworkContext } from '@src/hooks/useNetworkContext'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import { isCursorInFunctionDefinition } from '@src/lang/queryAst'
import { isCursorInSketchCommandRange } from '@src/lang/util'
import type { ArtifactGraph, Program } from '@src/lang/wasm'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { getUnrenderedChangesDisabledReason } from '@src/lib/automaticRendering'
import { EngineConnectionStateType } from '@src/lib/engineConnection/utils'
import type {
  ToolbarDropdown,
  ToolbarItem,
  ToolbarItemCallbackProps,
  ToolbarItemResolved,
  ToolbarItemResolvedDropdown,
  ToolbarConfig,
} from '@src/lib/toolbar'
import {
  getToolbarItemDescription,
  isSketchToolbarTransitioning,
  isToolbarItemResolvedDropdown,
  modelingMachineStateToToolbarModeName,
  toolbarModeNameToKeymapScope,
} from '@src/lib/toolbar'
import type { ToolbarToast } from '@src/lib/toolbarToast'
import type { Command } from '@src/lib/commandTypes'
import { reportRejection } from '@src/lib/trap'
import { isArray, type Platform } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { getSymmetricToolSelectionStep } from '@src/machines/sketchSolve/constraints/constraintUtils'
import type { sketchSolveMachine } from '@src/machines/sketchSolve/sketchSolveDiagram'
import {
  findKeymapItemForCommand,
  keymapKeystrokesDisplay,
  type KeymapTree,
  type KeymapScope,
} from '@src/registry/contracts/keymap'
import { APP_COMMAND_IDS } from '@src/registry/extensions/commands/appCommands'
import { useSelector } from '@xstate/react'
import { memo, useMemo } from 'react'
import type { SnapshotFrom } from 'xstate'

export type ModelingMachineToolbarProps = {
  isExecuting: boolean
  disableModelingForUnrenderedChanges: boolean
} & Omit<ReturnType<typeof useModelingContext>, 'theProject'> &
  Pick<
    ReturnType<typeof useNetworkContext>,
    'overallState' | 'immediateState'
  > &
  Pick<
    ReturnType<typeof useAppState>,
    'isStreamReady' | 'isStreamAcceptingInput'
  >

/** Per-view inputs for the existing machine-state toolbar resolver. Legacy app lookup stays in `Toolbar`. */
export interface ModelingMachineToolbarHost {
  toolbarConfig: ToolbarConfig
  registeredCommands: readonly Command[]
  activeDialogCommandKey: string | undefined
  keymapTree: KeymapTree
  keymapScopes: readonly KeymapScope[]
  platform: Platform
  wasmInstance: ModuleType
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  editorHasFocus: boolean
  execute: (() => Promise<unknown>) | undefined
  toasts: readonly ToolbarToast[]
}
const UNRENDERED_EXECUTE_HOTKEY = 'mod+s'

export function ModelingMachineToolbar(
  props: ModelingMachineToolbarProps & { host: ModelingMachineToolbarHost }
) {
  useSignals()
  const { host } = props
  const {
    toolbarConfig,
    registeredCommands,
    activeDialogCommandKey,
    keymapTree,
    keymapScopes,
    platform,
    wasmInstance,
  } = host
  const sketchPathId = useMemo(() => {
    if (
      isCursorInFunctionDefinition(
        host.ast,
        props.context.selectionRanges.graphSelections[0],
        wasmInstance
      )
    )
      return false
    return isCursorInSketchCommandRange(
      host.artifactGraph,
      props.context.selectionRanges
    )
  }, [
    host.ast,
    host.artifactGraph,
    props.context.selectionRanges,
    wasmInstance,
  ])

  const disableAllButtons =
    (props.overallState !== NetworkHealthState.Ok &&
      props.overallState !== NetworkHealthState.Weak) ||
    props.isExecuting ||
    props.disableModelingForUnrenderedChanges ||
    props.immediateState.type !==
      EngineConnectionStateType.ConnectionEstablished ||
    !props.isStreamReady ||
    !props.isStreamAcceptingInput

  // Load bearing logic for determining the items in the toolbar
  // Based on the state of the modeling machine determine what toolbar should be rendered
  const toolbarConfigurationName = modelingMachineStateToToolbarModeName(
    props.state
  )
  const currentToolbarKeymapScopes = [
    toolbarModeNameToKeymapScope[toolbarConfigurationName],
  ]
  const unrenderedExecuteHotkeyLabel = keymapKeystrokesDisplay(
    findKeymapItemForCommand(
      keymapTree,
      APP_COMMAND_IDS.editor.render,
      currentToolbarKeymapScopes,
      keymapScopes
    )?.keystrokes ?? [UNRENDERED_EXECUTE_HOTKEY],
    platform
  )
  const sketchSolveIsExiting = useSelector(
    props.state.children.sketchSolveMachine,
    (snapshot) =>
      isSketchSolveSnapshot(snapshot) &&
      (snapshot.matches('exiting with cleanup') || snapshot.matches('exiting'))
  )
  const disableSketchToolbar =
    (isSketchToolbarTransitioning(props.state) || sketchSolveIsExiting) &&
    (toolbarConfigurationName === 'sketching' ||
      toolbarConfigurationName === 'sketchSolve')

  const showNonVisualConstraints = props.state.context.showNonVisualConstraints
  const sketchSolveSelectedIdsKey = useSelector(
    props.state.children.sketchSolveMachine,
    (snapshot) =>
      isSketchSolveSnapshot(snapshot)
        ? snapshot.context.selectedIds.join('|')
        : ''
  )
  const symmetricToolPrompt = useSelector(
    props.state.children.sketchSolveMachine,
    (snapshot) => {
      if (!isSketchSolveSnapshot(snapshot)) {
        return null
      }

      if (snapshot.context.sketchSolveToolName !== 'symmetricConstraintTool') {
        return null
      }

      const objects =
        snapshot.context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects
      if (!isArray(objects)) {
        return null
      }

      const selectedObjectIds = snapshot.context.selectedIds.filter(
        (selectionId): selectionId is number => typeof selectionId === 'number'
      )
      const selectionStep = getSymmetricToolSelectionStep(
        selectedObjectIds,
        objects
      )

      if (selectionStep === 'select-axis') {
        return 'Select a symmetry axis.'
      }

      if (selectionStep === 'select-pair') {
        return 'Select two points, lines, arcs, or circles to mirror.'
      }

      return null
    }
  )

  /** These are the props that will be passed to the callbacks in the toolbar config
   * They are memoized to prevent unnecessary re-renders,
   * but they still get a lot of churn from the state machine
   * so I think there's a lot of room for improvement here
   */
  const configCallbackProps: ToolbarItemCallbackProps = useMemo(
    () => ({
      modelingState: props.state,
      modelingSend: props.send,
      sketchPathId,
      editorHasFocus: host.editorHasFocus,
      isActive: false, // Default value - individual items will override this
      keepSelection: false,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    [
      props.state,
      props.send,
      sketchPathId,

      host.editorHasFocus,
    ]
  )

  /**
   * Resolve all the callbacks and values for the current mode,
   * so we don't need to worry about the other modes
   */
  const currentModeItems: (
    | ToolbarItemResolved
    | ToolbarItemResolvedDropdown
    | 'break'
  )[] = useMemo(() => {
    return toolbarConfig[toolbarConfigurationName].items.map(
      (maybeIconConfig) => {
        if (maybeIconConfig === 'break') {
          return 'break'
        } else if (isToolbarDropdown(maybeIconConfig)) {
          return {
            id: maybeIconConfig.id,
            display: maybeIconConfig.display,
            visibleItemCount: maybeIconConfig.visibleItemCount,
            defaultVisibleItemIds: maybeIconConfig.defaultVisibleItemIds,
            array: maybeIconConfig.array.map((item) =>
              resolveItemConfig(item, wasmInstance)
            ),
          }
        } else {
          return resolveItemConfig(maybeIconConfig, wasmInstance)
        }
      }
    )

    function resolveItemConfig(
      maybeIconConfig: ToolbarItem,
      wasmInstance: ModuleType
    ): ToolbarItemResolved {
      const isConfiguredAvailable = ['available', 'experimental'].includes(
        maybeIconConfig.status
      )

      // Calculate the isActive state for this specific item
      const itemIsActive =
        maybeIconConfig.isActive?.(props.state) ||
        (activeDialogCommandKey !== undefined &&
          maybeIconConfig.command === activeDialogCommandKey)

      // Create item-specific callback props with the correct isActive value
      const itemCallbackProps = {
        ...configCallbackProps,
        isActive: itemIsActive,
      }
      const isDisabled =
        disableAllButtons ||
        disableSketchToolbar ||
        !isConfiguredAvailable ||
        maybeIconConfig.disabled?.(
          props.state,
          wasmInstance,
          itemCallbackProps
        ) === true

      const title =
        typeof maybeIconConfig.title === 'string'
          ? maybeIconConfig.title
          : maybeIconConfig.title(itemCallbackProps)
      const tooltipTitle =
        maybeIconConfig.tooltipTitle === undefined
          ? undefined
          : typeof maybeIconConfig.tooltipTitle === 'string'
            ? maybeIconConfig.tooltipTitle
            : maybeIconConfig.tooltipTitle(itemCallbackProps)
      const iconColor =
        typeof maybeIconConfig.iconColor === 'function'
          ? maybeIconConfig.iconColor(itemCallbackProps)
          : maybeIconConfig.iconColor

      return {
        ...maybeIconConfig,
        title,
        tooltipTitle,
        iconColor,
        description: getToolbarItemDescription(
          maybeIconConfig,
          registeredCommands
        ),
        links: maybeIconConfig.links || [],
        isActive: itemIsActive,
        hotkey: getToolbarItemHotkey(maybeIconConfig.command),
        disabled: isDisabled,
        disabledReason:
          props.disableModelingForUnrenderedChanges && isDisabled
            ? getUnrenderedChangesDisabledReason()
            : typeof maybeIconConfig.disabledReason === 'function'
              ? maybeIconConfig.disabledReason(props.state, itemCallbackProps)
              : maybeIconConfig.disabledReason,
        status: maybeIconConfig.status,
        // Store the item-specific callback props for use in onClick handlers
        callbackProps: itemCallbackProps,
      }
    }
    function getToolbarItemHotkey(command: string | undefined) {
      if (!command) {
        return undefined
      }

      const item = findKeymapItemForCommand(
        keymapTree,
        command,
        currentToolbarKeymapScopes,
        keymapScopes
      )
      return item?.keystrokes.length ? [...item.keystrokes] : undefined
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [
    toolbarConfigurationName,
    toolbarConfig,
    disableAllButtons,
    disableSketchToolbar,
    configCallbackProps,
    wasmInstance,
    showNonVisualConstraints,
    sketchSolveSelectedIdsKey,
    keymapTree,
    registeredCommands,
    activeDialogCommandKey,
  ])

  const adaptItem = (item: ToolbarItemResolved): ToolbarViewItem => {
    const { callbackProps, onClick, disabledReason, ...presentation } = item
    return {
      ...presentation,
      disabledReason:
        typeof disabledReason === 'function'
          ? disabledReason(props.state, callbackProps)
          : disabledReason,
      onClick: (event) =>
        onClick({
          ...callbackProps,
          keepSelection: event.metaKey || event.ctrlKey,
        }),
    }
  }
  const items: ToolbarViewEntry[] = currentModeItems.map((item) =>
    item === 'break'
      ? item
      : isToolbarItemResolvedDropdown(item)
        ? { ...item, array: item.array.map(adaptItem) }
        : adaptItem(item)
  )
  return (
    <ToolbarView
      items={items}
      mode={toolbarConfigurationName}
      platform={platform}
      disabled={disableSketchToolbar}
      disableAllButtons={disableAllButtons}
    >
      <ToolbarToasts toasts={host.toasts} />
      {props.disableModelingForUnrenderedChanges && (
        <div className="mt-2 py-1 px-2 bg-2 text-2 border border-chalkboard-20 dark:border-chalkboard-80 rounded shadow-lg flex items-center gap-2">
          <p className="text-xs m-0">{getUnrenderedChangesDisabledReason()}</p>
          <button
            type="button"
            className="flex gap-1 items-center py-0 pl-0.5 pr-1 m-0 flex-none text-primary dark:text-primary border border-solid border-primary bg-primary/10 dark:bg-primary/20 hover:bg-primary/20 dark:hover:bg-primary/30 hover:border-primary active:border-primary disabled:cursor-wait disabled:opacity-70"
            disabled={props.isExecuting || !host.execute}
            onClick={() => {
              host.execute?.().catch(reportRejection)
            }}
          >
            <CustomIcon name="play" className="w-5 h-5" />
            <span>Execute</span>
            {unrenderedExecuteHotkeyLabel && (
              <kbd className="hotkey text-xs">
                {unrenderedExecuteHotkeyLabel}
              </kbd>
            )}
          </button>
        </div>
      )}
      {props.state.matches('Sketch no face') && (
        <div className="mt-2 py-1 px-2 bg-chalkboard-10 dark:bg-chalkboard-90 border border-chalkboard-20 dark:border-chalkboard-80 rounded shadow-lg">
          <p className="text-xs">Select a plane or face to start sketching.</p>
        </div>
      )}
      {symmetricToolPrompt && (
        <div className="mt-2 py-1 px-2 bg-chalkboard-10 dark:bg-chalkboard-90 border border-chalkboard-20 dark:border-chalkboard-80 rounded shadow-lg">
          <p className="text-xs">{symmetricToolPrompt}</p>
        </div>
      )}
    </ToolbarView>
  )
}

const ToolbarToasts = memo(function ToolbarToasts({
  toasts,
}: {
  toasts: readonly ToolbarToast[]
}) {
  if (toasts.length === 0) {
    return null
  }

  return (
    <>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          aria-live="polite"
          className="mt-2 w-max max-w-[calc(100vw-2rem)] whitespace-nowrap rounded-sm border border-chalkboard-20/50 bg-chalkboard-10 px-4 py-2 text-sm leading-5 text-chalkboard-110 shadow-lg dark:border-chalkboard-80/50 dark:bg-chalkboard-90 dark:text-chalkboard-10"
        >
          {toast.message}
        </div>
      ))}
    </>
  )
})

function isToolbarDropdown(
  item: ToolbarItem | ToolbarDropdown
): item is ToolbarDropdown {
  return 'array' in item
}

function isSketchSolveSnapshot(
  snapshot: unknown
): snapshot is SnapshotFrom<typeof sketchSolveMachine> {
  return !!(
    snapshot &&
    typeof snapshot === 'object' &&
    'context' in snapshot &&
    snapshot.context &&
    typeof snapshot.context === 'object' &&
    'selectedIds' in snapshot.context &&
    isArray(snapshot.context.selectedIds) &&
    'sketchSolveToolName' in snapshot.context
  )
}
