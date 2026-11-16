import ModelingToolDialogView from '@src/lib/kcl/ModelingToolDialog'
import { ErrorBanner } from '@src/components/ErrorBanner'
import { machineDialogPicking } from '@src/lib/kcl/machine/dialogPicking'
import type { SelectionArgument } from '@src/components/ModelingDialog/arguments'
import { keyboardEventToKeymapChord } from '@src/lib/keymapEvent'
import { matchKeymapKeystrokes } from '@src/registry/contracts/keymap'
import { isArray } from '@src/lib/utils'
import { useSignals } from '@preact/signals-react/runtime'
import { useSelector } from '@xstate/react'
import { useEffect, useRef, useCallback } from 'react'
import { ClientSideSceneView } from '@src/clientSideScene/ClientSideSceneView'
import { ModelingMachineToolbar } from '@src/components/Toolbar/ModelingMachineToolbar'
import ModelingDialog from '@src/components/ModelingDialog/ModelingDialog'
import { ModelingMachineContext } from '@src/machines/modelingMachineContext'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import usePlatform from '@src/hooks/usePlatform'
import { EngineConnectionStateType } from '@src/lib/engineConnection/utils'
import { commandKey, isModelingDialogCommand } from '@src/lib/commandUtils'
import type { MachineModelingOwner } from '@src/lib/kcl/machine/host'
import type { ModelingViewRuntime } from '@src/lib/kcl/registry/contract'
import {
  modelingMachineStateToToolbarModeName,
  toolbarModeNameToKeymapScope,
} from '@src/lib/toolbar'
import { toolbarToastsSignal } from '@src/lib/toolbarToast'
import type { Project } from '@src/lib/project'

/** Reuse the file route's machine-driven views with the manager, commands, and scene owned by this editor view. */
export function MachineModelingView({
  owner,
  context,
}: {
  owner: MachineModelingOwner
  context: ModelingViewRuntime
}) {
  useSignals()
  const state = owner.state.value
  const commands = useSelector(owner.commands.actor, (snapshot) => snapshot)
  const project = useRef<Project | undefined>(undefined)
  project.current = owner.model.systemDeps.project.value
  const container = useRef<HTMLDivElement>(null)
  const platform = usePlatform()
  const current = commands.context.selectedCommand
  const ownsCommand = current?.machineActor === owner.actor
  const dialogOpen =
    ownsCommand &&
    !commands.matches('Closed') &&
    current &&
    isModelingDialogCommand(current)
  const settings = context.settings.current.value
  const selectionField = useCallback(
    (field: { name: string; arg: SelectionArgument } | undefined) => {
      owner.pickingArgument.value = field
        ? machineDialogPicking(owner, field)
        : undefined
    },
    [owner]
  )
  useEffect(() => {
    const element = owner.scene.element
    let pending: string[] = []
    let timer: ReturnType<typeof setTimeout> | undefined
    const key = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        (event.target instanceof Element &&
          event.target.closest(
            'input,textarea,select,[contenteditable="true"]'
          ))
      )
        return
      const chord = keyboardEventToKeymapChord(event)
      if (!chord) return
      const commands = new Map(
        owner.commands.actor
          .getSnapshot()
          .context.commands.map((command) => [commandKey(command), command])
      )
      const scope =
        toolbarModeNameToKeymapScope[
          modelingMachineStateToToolbarModeName(owner.actor.getSnapshot())
        ]
      const match = matchKeymapKeystrokes(
        owner.keymapTree.peek(),
        [scope],
        [...pending, chord],
        owner.keymapScopes.peek(),
        (item) => {
          const command = commands.get(item.command)
          return !!command && !command.disabled
        }
      )
      clearTimeout(timer)
      if (match.type === 'none') {
        pending = []
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (match.type === 'prefix') {
        pending.push(chord)
        timer = setTimeout(() => {
          pending = []
        }, 1000)
        return
      }
      pending = []
      const command = commands.get(match.item.command)
      if (!command) return
      const args = match.item.arguments
      owner.commands.send({
        type: 'Find and select command',
        data: {
          name: String(command.name),
          groupId: command.groupId,
          ...(args && typeof args === 'object' && !isArray(args)
            ? { argDefaultValues: args }
            : {}),
        },
      })
    }
    element.addEventListener('keydown', key)
    return () => {
      clearTimeout(timer)
      element.removeEventListener('keydown', key)
    }
  }, [owner])
  return (
    <ModelingMachineContext.Provider
      value={{
        state,
        context: state.context,
        send: (event) => owner.actor.send(event),
        actor: owner.actor,
        theProject: project,
      }}
    >
      <ClientSideSceneView
        host={{
          kclManager: owner.model,
          commands: owner.commands,
          settings: context.settings,
          toolbarConfig: owner.toolbarConfig,
        }}
        container={owner.scene.element}
        cameraControls={settings.modeling.mouseControls.current}
        enableTouchControls={settings.modeling.enableTouchControls.current}
      />
      <div className="toolbar-container pointer-events-none absolute inset-x-0 top-0 z-[19]">
        <ModelingMachineToolbar
          state={state}
          context={state.context}
          actor={owner.actor}
          send={(event) => owner.actor.send(event)}
          isExecuting={
            owner.model.isExecutingSignal.value ||
            context.executor.output.value.running
          }
          disableModelingForUnrenderedChanges={
            context.executor.editor.readOnly.value
          }
          overallState={NetworkHealthState.Ok}
          immediateState={{
            type: EngineConnectionStateType.ConnectionEstablished,
          }}
          isStreamReady={owner.scene.isConnected()}
          isStreamAcceptingInput={owner.scene.isConnected()}
          host={{
            toolbarConfig: owner.toolbarConfig,
            registeredCommands: owner.commandDefinitions.value,
            activeDialogCommandKey: dialogOpen
              ? commandKey(current)
              : undefined,
            keymapTree: owner.keymapTree.value,
            keymapScopes: owner.keymapScopes.value,
            platform,
            wasmInstance: state.context.wasmInstance,
            ast: owner.model.ast,
            artifactGraph: owner.model.artifactGraph,
            editorHasFocus: false,
            execute: () => owner.model.executeCode(),
            toasts: toolbarToastsSignal.value,
          }}
        />
      </div>
      {context.tools.error.value && (
        <div className="absolute top-20 right-2 z-50">
          <ErrorBanner
            title="Unable to open tool"
            message={context.tools.error.value.message}
          />
        </div>
      )}
      {owner.dialogs.active.value && (
        <ModelingToolDialogView dialog={owner.dialogs.active.value} />
      )}
      {dialogOpen && !owner.dialogs.supported.value && (
        <div
          ref={container}
          className="pointer-events-none absolute inset-x-2 top-20 bottom-2 z-50 flex items-start justify-end"
        >
          <ModelingDialog
            containerRef={container}
            onSelectionFieldChange={selectionField}
            kclManager={owner.model}
            commands={owner.commands}
            settings={context.settings}
            wasmPromise={context.wasm}
            selectionRanges={state.context.selectionRanges}
            modelingSend={(event) => owner.actor.send(event)}
          />
        </div>
      )}
    </ModelingMachineContext.Provider>
  )
}
