import { useAppState } from '@src/AppState'
import { letEngineAnimateAndSyncCamAfter } from '@src/clientSideScene/CameraControls'
import { useMenuListener } from '@src/hooks/useMenu'
import { useSketchModeMenuEnableDisable } from '@src/hooks/useSketchModeMenuEnableDisable'
import useModelingMachineCommands from '@src/hooks/useStateMachineCommands'
import { reportRejection } from '@src/lib/trap'
import { useMachine } from '@xstate/react'
import type React from 'react'
import { createContext, use, useEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import type { Actor, ContextFrom, Prop, StateFrom } from 'xstate'

import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { useApp, useSingletons } from '@src/lib/boot'
import { modelingMachineCommandConfig } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import type { Project } from '@src/lib/project'
import { modelingMachine } from '@src/machines/modelingMachine'
import { useFolders } from '@src/machines/systemIO/hooks'

import { useSignals } from '@preact/signals-react/runtime'
import type { CameraOrbitType } from '@rust/kcl-lib/bindings/CameraOrbitType'
import { DefaultLayoutPaneID } from '@src/lib/layout'
import { togglePaneLayoutNode } from '@src/lib/layout/utils'
import {
  modelingMachineStateToToolbarModeName,
  toolbarModeNameToKeymapScope,
} from '@src/lib/toolbar'
import type { WebContentSendPayload } from '@src/menu/channels'
import {
  EngineConnectionEvents,
  EngineConnectionStateType,
} from '@src/network/utils'
import { keymapService } from '@src/registry/contracts/keymap'

export const ModelingMachineContext = createContext(
  {} as {
    state: StateFrom<typeof modelingMachine>
    context: ContextFrom<typeof modelingMachine>
    send: Prop<Actor<typeof modelingMachine>, 'send'>
    actor: Actor<typeof modelingMachine>
    theProject: MutableRefObject<Project | undefined>
  }
)

export const ModelingMachineProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  useSignals()
  const { machineManager, commands, settings, layout, project, registry } =
    useApp()
  const { kclManager } = useSingletons()
  const wasmInstance = use(kclManager.wasmInstancePromise)
  const settingsValues = settings.useSettings()
  const {
    app: { allowOrbitInSketchMode },
    modeling: {
      defaultUnit,
      cameraProjection,
      cameraOrbit,
      useSketchSolveMode,
    },
  } = settingsValues
  const machineApiEnabled = settingsValues.app.machineApi.current
  const commandBarConfig = useMemo(() => {
    if (machineApiEnabled) {
      return modelingMachineCommandConfig
    }

    const { Make: _make, ...configWithoutMake } = modelingMachineCommandConfig
    return configWithoutMake
  }, [machineApiEnabled])
  const previousCameraOrbit = useRef<CameraOrbitType | null>(null)
  const projects = useFolders()
  const theProject = useRef<Project | undefined>(
    project?.projectIORefSignal.value
  )
  const file = project?.executingFileEntry.value
  useEffect(() => {
    // Have no idea why the project loader data doesn't have the children from the ls on disk
    // That means it is a different object or cached incorrectly?
    if (!project || !file || !projects) {
      return
    }

    // You need to find the real project in the storage from the loader information since the loader Project is not hydrated
    const foundYourProject = projects.find((p) => {
      return p.name === project.name
    })

    if (!foundYourProject) {
      return
    }
    theProject.current = foundYourProject
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [projects, file])

  const streamRef = useRef<HTMLDivElement>(null)

  // Settings machine setup
  // const retrievedSettings = useRef(
  // localStorage?.getItem(MODELING_PERSIST_KEY) || '{}'
  // )

  // What should we persist from modeling state? Nothing?
  // const persistedSettings = Object.assign(
  //   settingsMachine.initialState.context,
  //   JSON.parse(retrievedSettings.current) as Partial<
  //     (typeof settingsMachine)['context']
  //   >
  // )

  const [modelingState, modelingSend, modelingActor] = useMachine(
    modelingMachine,
    {
      input: {
        machineManager,
        engineCommandManager: kclManager.engineCommandManager,
        kclManager,
        rustContext: kclManager.rustContext,
        commandBarActor: commands.actor,
        fileName: file?.name,
        projectRef: theProject,
        // React Suspense will await this
        wasmInstance,
        store: {
          useSketchSolveMode,
          cameraProjection,
          defaultUnit,
        },
      },
      // devTools: true,
    }
  )

  // Register file menu actions based off modeling send
  const cb = (data: WebContentSendPayload) => {
    const rootLayout = structuredClone(layout.signal.value)
    const toggle = (id: DefaultLayoutPaneID) =>
      layout.set(
        togglePaneLayoutNode({
          rootLayout,
          targetNodeId: id,
          shouldExpand: true,
        })
      )

    if (data.menuLabel === 'View.Panes.Feature tree') {
      toggle(DefaultLayoutPaneID.FeatureTree)
    } else if (data.menuLabel === 'View.Panes.KCL code') {
      toggle(DefaultLayoutPaneID.Code)
    } else if (data.menuLabel === 'View.Panes.Project files') {
      toggle(DefaultLayoutPaneID.Files)
    } else if (data.menuLabel === 'View.Panes.Variables') {
      toggle(DefaultLayoutPaneID.Variables)
    } else if (data.menuLabel === 'View.Panes.Logs') {
      toggle(DefaultLayoutPaneID.Logs)
    } else if (data.menuLabel === 'View.Panes.Zookeeper') {
      toggle(DefaultLayoutPaneID.TTC)
    } else if (data.menuLabel === 'Design.Start sketch') {
      modelingSend({
        type: 'Enter sketch',
        data: { forceNewSketch: true },
      })
    }
  }
  useMenuListener(cb)

  const { overallState } = useNetworkContext()
  const { isStreamReady } = useAppState()

  const toolbarConfigurationName =
    modelingMachineStateToToolbarModeName(modelingState)
  const toolbarModeKeymapScope =
    toolbarModeNameToKeymapScope[toolbarConfigurationName]
  const keymap = registry.get(keymapService)

  useEffect(() => {
    keymap.applyScope(toolbarModeKeymapScope)
    return () => {
      keymap.removeScope(toolbarModeKeymapScope)
    }
  }, [keymap, toolbarModeKeymapScope])

  // Assumes all commands are network commands
  useSketchModeMenuEnableDisable(
    toolbarConfigurationName,
    overallState,
    kclManager.isExecutingSignal.value,
    isStreamReady,
    [
      { menuLabel: 'View.Standard views' },
      { menuLabel: 'View.Named views' },
      { menuLabel: 'Design.Start sketch' },
      {
        menuLabel: 'Design.Create an offset plane',
        commandName: 'Offset plane',
        groupId: 'modeling',
      },
      {
        menuLabel: 'Design.Create a helix',
        commandName: 'Helix',
        groupId: 'modeling',
      },
      {
        menuLabel: 'Design.Create an additive feature.Extrude',
        commandName: 'Extrude',
        groupId: 'modeling',
      },
      {
        menuLabel: 'Design.Create an additive feature.Revolve',
        commandName: 'Revolve',
        groupId: 'modeling',
      },
      {
        menuLabel: 'Design.Create an additive feature.Sweep',
        commandName: 'Sweep',
        groupId: 'modeling',
      },
      {
        menuLabel: 'Design.Create an additive feature.Loft',
        commandName: 'Loft',
        groupId: 'modeling',
      },
      {
        menuLabel: 'Design.Apply modification feature.Fillet',
        commandName: 'Fillet',
        groupId: 'modeling',
      },
      {
        menuLabel: 'Design.Apply modification feature.Chamfer',
        commandName: 'Chamfer',
        groupId: 'modeling',
      },
      {
        menuLabel: 'Design.Apply modification feature.Shell',
        commandName: 'Shell',
        groupId: 'modeling',
      },
    ]
  )

  // Add debug function to window object
  useEffect(() => {
    // @ts-ignore - we're intentionally adding this to window
    window.getModelingState = () => {
      const modelingState = modelingActor.getSnapshot()
      return {
        modelingState,
        id: modelingState._nodes[modelingState._nodes.length - 1].id,
      }
    }
  }, [modelingActor])

  // Give the state back to the kclManager.
  useEffect(() => {
    kclManager.modelingSend = modelingSend
  }, [modelingSend, kclManager])

  useEffect(() => {
    kclManager.modelingState = modelingState
  }, [modelingState, kclManager])

  useEffect(() => {
    kclManager.selectionRanges = modelingState.context.selectionRanges
  }, [modelingState.context.selectionRanges, kclManager])

  // When changing camera modes reset the camera to the default orientation to correct
  // the up vector otherwise the conconical orientation for the camera modes will be
  // wrong
  useEffect(() => {
    kclManager.engineCommandManager.connection?.deferredPeerConnection?.promise
      .then(() => {
        if (
          previousCameraOrbit.current === null ||
          cameraOrbit.current === previousCameraOrbit.current
        ) {
          // Do not reset, nothing has changed.
          // Do not trigger on first initialization either.
          previousCameraOrbit.current = cameraOrbit.current
          return
        }
        previousCameraOrbit.current = cameraOrbit.current
        // Gotcha: This will absolutely brick E2E tests if called incorrectly.
        kclManager.sceneInfra.camControls
          .resetCameraPosition()
          .catch(reportRejection)
      })
      .catch(reportRejection)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [cameraOrbit.current])

  useEffect(() => {
    const onConnectionStateChanged = ({ detail }: CustomEvent) => {
      if (detail.type === EngineConnectionStateType.Disconnecting) {
        modelingSend({ type: 'Cancel' })
      }
    }
    kclManager.engineCommandManager.connection?.addEventListener(
      EngineConnectionEvents.ConnectionStateChanged,
      onConnectionStateChanged as EventListener
    )
    return () => {
      kclManager.engineCommandManager.connection?.removeEventListener(
        EngineConnectionEvents.ConnectionStateChanged,
        onConnectionStateChanged as EventListener
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [kclManager.engineCommandManager.connection, modelingSend])

  useEffect(() => {
    const inSketchMode = modelingState.matches('Sketch')

    // If you are in sketch mode and you disable the orbit, return back to the normal view to the target
    if (!allowOrbitInSketchMode.current) {
      const targetId = modelingState.context.sketchDetails?.animateTargetId
      if (inSketchMode && targetId) {
        letEngineAnimateAndSyncCamAfter(
          kclManager.engineCommandManager,
          targetId
        )
          .then(() => {})
          .catch((e) => {
            console.error(
              'failed to sync engine and client scene after disabling allow orbit in sketch mode'
            )
            console.error(e)
          })
      }
    }

    // While you are in sketch mode you should be able to control the enable rotate
    // Once you exit it goes back to normal
    if (inSketchMode) {
      kclManager.sceneInfra.camControls.enableRotate =
        allowOrbitInSketchMode.current
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [allowOrbitInSketchMode.current])

  useModelingMachineCommands({
    machineId: 'modeling',
    state: modelingState,
    send: modelingSend,
    actor: modelingActor,
    commandBarConfig,
    isExecuting: kclManager.isExecutingSignal.value,
    // TODO for when sketch tools are in the toolbar: This was added when we used one "Cancel" event,
    // but we need to support "SketchCancel" and basically
    // make this function take the actor or state so it
    // can call the correct event.
    onCancel: () => modelingSend({ type: 'Cancel' }),
  })

  return (
    <ModelingMachineContext.Provider
      value={{
        state: modelingState,
        context: modelingState.context,
        send: modelingSend,
        actor: modelingActor,
        theProject,
      }}
    >
      {/* TODO #818: maybe pass reff down to children/app.ts or render app.tsx directly?
      since realistically it won't ever have generic children that isn't app.tsx */}
      <div className="h-screen overflow-hidden select-none" ref={streamRef}>
        {children}
      </div>
    </ModelingMachineContext.Provider>
  )
}

export default ModelingMachineProvider
