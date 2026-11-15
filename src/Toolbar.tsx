import {
  ModelingMachineToolbar,
  type ModelingMachineToolbarProps as ToolbarProps,
} from '@src/components/Toolbar/ModelingMachineToolbar'
import { useSignals } from '@preact/signals-react/runtime'
import { useAppState } from '@src/AppState'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useNetworkContext } from '@src/hooks/useNetworkContext'
import usePlatform from '@src/hooks/usePlatform'
import { shouldDisableModelingForUnrenderedChanges } from '@src/lib/automaticRendering'
import { useApp, useSingletons } from '@src/lib/boot'
import { commandKey, isModelingDialogCommand } from '@src/lib/commandUtils'
import { useToolbarConfig } from '@src/hooks/useToolbarConfig'
import { toolbarToastsSignal } from '@src/lib/toolbarToast'
import {
  keymapScopesFacet,
  keymapService,
} from '@src/registry/contracts/keymap'
import { projectSession } from '@src/registry/contracts/projectSession'
import { useSelector } from '@xstate/react'
import { memo, use } from 'react'

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
    const keymap = app.registry.required(keymapService)
    const keymapTree = keymap.keymap.value
    const { kclManager } = useSingletons()
    const platform = usePlatform()
    const executionService =
      app.registry.optional(projectSession)?.executingEditor.value
    const keymapScopes = app.registry.observe(keymapScopesFacet).value
    const toolbarConfig = useToolbarConfig()
    const wasmInstance = use(kclManager.wasmInstancePromise)
    return (
      <ModelingMachineToolbar
        {...props}
        host={{
          toolbarConfig,
          registeredCommands,
          activeDialogCommandKey,
          keymapTree,
          keymapScopes,
          platform,
          wasmInstance,
          ast: kclManager.ast,
          artifactGraph: kclManager.artifactGraph,
          editorHasFocus: kclManager.editorView.hasFocus,
          execute: executionService
            ? () => executionService.executeCode()
            : undefined,
          toasts: toolbarToastsSignal.value,
        }}
      />
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
