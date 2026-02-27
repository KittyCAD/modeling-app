import { useMachine } from '@xstate/react'
import type React from 'react'
import { createContext, use, useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import type { Actor, ContextFrom, Prop, StateFrom } from 'xstate'

import { useAppState } from '@src/AppState'
import { letEngineAnimateAndSyncCamAfter } from '@src/clientSideScene/CameraControls'
import {
  useMenuListener,
  useSketchModeMenuEnableDisable,
} from '@src/hooks/useMenu'
import useModelingMachineCommands from '@src/hooks/useStateMachineCommands'
import { reportRejection } from '@src/lib/trap'

import useHotkeyWrapper from '@src/lib/hotkeyWrapper'
import { SNAP_TO_GRID_HOTKEY } from '@src/lib/hotkeys'

import { useApp, useSingletons } from '@src/lib/boot'
import { getDeleteKeys } from '@src/lib/utils'
import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { modelingMachineCommandConfig } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import type { Project } from '@src/lib/project'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import { selectAllInCurrentSketch } from '@src/lib/selections'
import { modelingMachine } from '@src/machines/modelingMachine'
import { useFolders } from '@src/machines/systemIO/hooks'

import {
  EngineConnectionEvents,
  EngineConnectionStateType,
} from '@src/network/utils'
import type { WebContentSendPayload } from '@src/menu/channels'
import type { CameraOrbitType } from '@rust/kcl-lib/bindings/CameraOrbitType'
import { DefaultLayoutPaneID } from '@src/lib/layout'
import { togglePaneLayoutNode } from '@src/lib/layout/utils'
import { useSignals } from '@preact/signals-react/runtime'

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
  const { machineManager, commands, settings, layout, project } = useApp()
  const { engineCommandManager, kclManager, rustContext } = useSingletons()
  const settingsActor = settings.actor
  const wasmInstance = use(kclManager.wasmInstancePromise)
  const settingsValues = settings.useSettings()
  const {
    app: { allowOrbitInSketchMode },
    modeling: {
      defaultUnit,
      cameraProjection,
      cameraOrbit,
      useNewSketchMode,
      snapToGrid,
    },
  } = settingsValues
  const previousCameraOrbit = useRef<CameraOrbitType | null>(null)
  const projects = useFolders()
  const theProject = useRef<Project | undefined>(
    project?.projectIORefSignal.value
  )
  const file = project?.executingFileEntry.value
  useEffect(() => {
    // Have no idea why the project loader data doesn't have the children from the ls on disk
    // That means it is a different object or cached incorrectly?
    if (!project || !file) {
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
        engineCommandManager,
        kclManager,
        rustContext,
        commandBarActor: commands.actor,
        fileName: file?.name,
        projectRef: theProject,
        // React Suspense will await this
        wasmInstance,
        store: {
          useNewSketchMode,
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

  // Assumes all commands are network commands
  useSketchModeMenuEnableDisable(
    modelingState.context.currentMode,
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
    engineCommandManager.connection?.deferredPeerConnection?.promise
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
    engineCommandManager.connection?.addEventListener(
      EngineConnectionEvents.ConnectionStateChanged,
      onConnectionStateChanged as EventListener
    )
    return () => {
      engineCommandManager.connection?.removeEventListener(
        EngineConnectionEvents.ConnectionStateChanged,
        onConnectionStateChanged as EventListener
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [engineCommandManager.connection, modelingSend])

  useEffect(() => {
    const inSketchMode = modelingState.matches('Sketch')

    // If you are in sketch mode and you disable the orbit, return back to the normal view to the target
    if (!allowOrbitInSketchMode.current) {
      const targetId = modelingState.context.sketchDetails?.animateTargetId
      if (inSketchMode && targetId) {
        letEngineAnimateAndSyncCamAfter(engineCommandManager, targetId)
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

  // Allow using the delete key to delete solids. Backspace only on macOS as Windows and Linux have dedicated Delete
  // `navigator.platform` is deprecated, but the alternative `navigator.userAgentData.platform` is not reliable
  const deleteKeys = getDeleteKeys()

  useHotkeys(deleteKeys, () => {
    // Check if we're in sketch solve mode
    const inSketchSolveMode = modelingState.matches('sketchSolveMode')
    if (inSketchSolveMode) {
      // Forward delete event to sketch solve mode
      // it's probably save to send this regardless of inSketchSolveMode, but still
      modelingSend({ type: 'delete selected' })
      return
    }

    // When the current selection is a segment, delete that directly ('Delete selection' doesn't support it)
    const segmentNodePaths = Object.keys(modelingState.context.segmentOverlays)
    const selections =
      modelingState.context.selectionRanges.graphSelections.filter((sel) =>
        segmentNodePaths.includes(JSON.stringify(sel.codeRef.pathToNode))
      )
    // Order selections by how late they are used in the codebase, as later nodes are less likely to be referenced than
    // earlier ones. This could be further refined as this is just a simple heuristic.
    const orderedSelections = selections.slice().sort((a, b) => {
      const aStart = a.codeRef.range?.[0] ?? 0
      const bStart = b.codeRef.range?.[0] ?? 0
      return bStart - aStart
    })
    modelingSend({
      type: 'Delete segments',
      data: orderedSelections.map((selection) => selection.codeRef.pathToNode),
    })
    if (
      modelingState.context.selectionRanges.graphSelections.length >
      selections.length
    ) {
      // Not all selection were segments -> keep the default delete behavior
      modelingSend({ type: 'Delete selection' })
    }
  })

  // Allow ctrl+alt+c to center to selection
  useHotkeys(['mod + alt + c'], () => {
    modelingSend({ type: 'Center camera on selection' })
  })
  useHotkeys(['mod + alt + x'], () => {
    resetCameraPosition({
      sceneInfra: kclManager.sceneInfra,
      engineCommandManager,
      settingsActor,
    }).catch(reportRejection)
  })

  // Toggle Snap to grid
  useHotkeyWrapper(
    [SNAP_TO_GRID_HOTKEY],
    () => {
      settingsActor.send({
        type: 'set.modeling.snapToGrid',
        data: { level: 'project', value: !snapToGrid.current },
      })
    },
    kclManager
  )

  useHotkeys(
    ['mod + a'],
    (e) => {
      const inSketchMode = modelingState.matches('Sketch')
      if (!inSketchMode) return

      e.preventDefault()
      const selection = selectAllInCurrentSketch(
        kclManager.artifactGraph,
        kclManager.sceneEntitiesManager
      )
      modelingSend({
        type: 'Set selection',
        data: { selectionType: 'completeSelection', selection },
      })
    },
    {
      enableOnContentEditable: false,
    }
  )

  const commandBarState = commands.useState()

  // Global Esc handler for sketch solve mode when command bar is closed
  useHotkeys(
    'esc',
    () => {
      // Only handle Esc if we're in sketch solve mode and command bar is closed
      if (
        modelingState.matches('sketchSolveMode') &&
        commandBarState.matches('Closed')
      ) {
        modelingSend({ type: 'Cancel' })
      }
    },
    {
      enableOnFormTags: false,
      enableOnContentEditable: false,
    },
    [modelingState, commandBarState, modelingSend]
  )

  useModelingMachineCommands({
    machineId: 'modeling',
    state: modelingState,
    send: modelingSend,
    actor: modelingActor,
    commandBarConfig: modelingMachineCommandConfig,
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
