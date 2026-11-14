import {
  ToolbarView,
  type ToolbarViewEntry,
  type ToolbarViewItem,
} from '@src/components/Toolbar/ToolbarView'
import { useSignals } from '@preact/signals-react/runtime'
import { useAppState } from '@src/AppState'
import { CustomIcon } from '@src/components/CustomIcon'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import usePlatform from '@src/hooks/usePlatform'
import { isCursorInFunctionDefinition } from '@src/lang/queryAst'
import { isCursorInSketchCommandRange } from '@src/lang/util'
import {
  getUnrenderedChangesDisabledReason,
  shouldDisableModelingForUnrenderedChanges,
} from '@src/lib/automaticRendering'
import { useApp, useSingletons } from '@src/lib/boot'
import { commandKey, isModelingDialogCommand } from '@src/lib/commandUtils'
import { EngineConnectionStateType } from '@src/lib/engineConnection/utils'
import type {
  ToolbarDropdown,
  ToolbarItem,
  ToolbarItemCallbackProps,
  ToolbarItemResolved,
  ToolbarItemResolvedDropdown,
} from '@src/lib/toolbar'
import {
  getToolbarItemDescription,
  isSketchToolbarTransitioning,
  isToolbarItemResolvedDropdown,
  modelingMachineStateToToolbarModeName,
  toolbarModeNameToKeymapScope,
  useToolbarConfig,
} from '@src/lib/toolbar'
import { toolbarToastsSignal } from '@src/lib/toolbarToast'
import { reportRejection } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { getSymmetricToolSelectionStep } from '@src/machines/sketchSolve/constraints/constraintUtils'
import type { sketchSolveMachine } from '@src/machines/sketchSolve/sketchSolveDiagram'
import {
  findKeymapItemForCommand,
  keymapKeystrokesDisplay,
  keymapScopesValueSpec,
  keymapService,
} from '@src/registry/contracts/keymap'
import { projectSession } from '@src/registry/contracts/projectSession'
import { APP_COMMAND_IDS } from '@src/registry/extensions/commands/appCommands'
import { useSelector } from '@xstate/react'
import { memo, use, useMemo } from 'react'
import type { SnapshotFrom } from 'xstate'

type ToolbarProps = {
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

const UNRENDERED_EXECUTE_HOTKEY = 'mod+s'

const Toolbar_ = memo(
  (props: ToolbarProps) => {
    useSignals()
    const app = useApp()
    const registeredCommands = useSelector(
      app.commands.actor,
      (state) => state.context.commands
    )
    const activeDialogCommandKey = useSelector(app.commands.actor, (state) => {
      const command = state.context.selectedCommand
      return !state.matches('Closed') &&
        command &&
        isModelingDialogCommand(command)
        ? commandKey(command)
        : undefined
    })
    const keymap = app.registry.get(keymapService)
    const keymapTree = keymap.keymap.value
    const { kclManager } = useSingletons()
    const platform = usePlatform()
    const executionService =
      app.registry.signal(projectSession).value?.executingEditor.value
    const keymapScopes = app.registry.signal(keymapScopesValueSpec).value
    const toolbarConfig = useToolbarConfig()
    const wasmInstance = use(kclManager.wasmInstancePromise)
    const sketchPathId = useMemo(() => {
      if (
        isCursorInFunctionDefinition(
          kclManager.ast,
          props.context.selectionRanges.graphSelections[0],
          wasmInstance
        )
      )
        return false
      return isCursorInSketchCommandRange(
        kclManager.artifactGraph,
        props.context.selectionRanges
      )
      // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    }, [kclManager.artifactGraph, props.context.selectionRanges])

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
        (snapshot.matches('exiting with cleanup') ||
          snapshot.matches('exiting'))
    )
    const disableSketchToolbar =
      (isSketchToolbarTransitioning(props.state) || sketchSolveIsExiting) &&
      (toolbarConfigurationName === 'sketching' ||
        toolbarConfigurationName === 'sketchSolve')

    const showNonVisualConstraints =
      props.state.context.showNonVisualConstraints
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

        if (
          snapshot.context.sketchSolveToolName !== 'symmetricConstraintTool'
        ) {
          return null
        }

        const objects =
          snapshot.context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects
        if (!isArray(objects)) {
          return null
        }

        const selectedObjectIds = snapshot.context.selectedIds.filter(
          (selectionId): selectionId is number =>
            typeof selectionId === 'number'
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
        editorHasFocus: kclManager.editorView.hasFocus,
        isActive: false, // Default value - individual items will override this
        keepSelection: false,
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
      [
        props.state,
        props.send,
        sketchPathId,

        kclManager.editorView.hasFocus,
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
        <ToolbarToasts />
        {props.disableModelingForUnrenderedChanges && (
          <div className="mt-2 py-1 px-2 bg-2 text-2 border border-chalkboard-20 dark:border-chalkboard-80 rounded shadow-lg flex items-center gap-2">
            <p className="text-xs m-0">
              {getUnrenderedChangesDisabledReason()}
            </p>
            <button
              type="button"
              className="flex gap-1 items-center py-0 pl-0.5 pr-1 m-0 flex-none text-primary dark:text-primary border border-solid border-primary bg-primary/10 dark:bg-primary/20 hover:bg-primary/20 dark:hover:bg-primary/30 hover:border-primary active:border-primary disabled:cursor-wait disabled:opacity-70"
              disabled={props.isExecuting || !executionService}
              onClick={() => {
                executionService?.executeCode().catch(reportRejection)
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
            <p className="text-xs">
              Select a plane or face to start sketching.
            </p>
          </div>
        )}
        {symmetricToolPrompt && (
          <div className="mt-2 py-1 px-2 bg-chalkboard-10 dark:bg-chalkboard-90 border border-chalkboard-20 dark:border-chalkboard-80 rounded shadow-lg">
            <p className="text-xs">{symmetricToolPrompt}</p>
          </div>
        )}
      </ToolbarView>
    )
  },
  (oldP, newP) =>
    oldP.isExecuting === newP.isExecuting &&
    oldP.state.value === newP.state.value &&
    oldP.overallState === newP.overallState &&
    oldP.immediateState?.type === newP.immediateState?.type &&
    oldP.isStreamReady === newP.isStreamReady &&
    oldP.isStreamAcceptingInput === newP.isStreamAcceptingInput &&
    oldP.disableModelingForUnrenderedChanges ===
      newP.disableModelingForUnrenderedChanges &&
    oldP.context?.currentTool === newP.context?.currentTool
)

const ToolbarToasts = memo(function ToolbarToasts() {
  useSignals()
  const toasts = toolbarToastsSignal.value

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

// Making this toplevel Toolbar memo'd is no-op, because we use context
// inside that causes a render anyway. Instead we memo the inner.
export function Toolbar() {
  const { kclManager } = useSingletons()
  const { settings } = useApp()
  const settingsValues = settings.useSettings()
  const { state, send, context, actor } = useModelingContext()
  const { overallState, immediateState } = useNetworkContext()
  const { isStreamReady, isStreamAcceptingInput } = useAppState()
  useSignals()
  const disableModelingForUnrenderedChanges =
    shouldDisableModelingForUnrenderedChanges({
      settings: settingsValues,
      hasEditsSinceLastExecution:
        kclManager.hasEditsSinceLastExecutionSignal.value,
    })

  return (
    <Toolbar_
      state={state}
      send={send}
      context={context}
      overallState={overallState}
      immediateState={immediateState}
      isStreamReady={isStreamReady}
      actor={actor}
      isStreamAcceptingInput={isStreamAcceptingInput}
      isExecuting={kclManager.isExecutingSignal.value}
      disableModelingForUnrenderedChanges={disableModelingForUnrenderedChanges}
    />
  )
}

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
