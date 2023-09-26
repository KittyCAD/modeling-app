import { useMachine } from '@xstate/react'
import React, { createContext, useEffect, useRef } from 'react'
import {
  AnyStateMachine,
  ContextFrom,
  InterpreterFrom,
  Prop,
  StateFrom,
} from 'xstate'
import { modelingMachine } from 'machines/modelingMachine'
import { useSetupEngineManager } from 'hooks/useSetupEngineManager'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import { isCursorInSketchCommandRange } from 'hooks/useAppMode'
import { engineCommandManager } from 'lang/std/engineConnection'

type MachineContext<T extends AnyStateMachine> = {
  state: StateFrom<T>
  context: ContextFrom<T>
  send: Prop<InterpreterFrom<T>, 'send'>
}

export const ModelingMachineContext = createContext(
  {} as MachineContext<typeof modelingMachine>
)

export const ModelingMachineProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const {
    auth: {
      context: { token },
    },
  } = useGlobalStateContext()
  const streamRef = useRef<HTMLDivElement>(null)
  useSetupEngineManager(streamRef, token)

  // const { commands } = useCommandsContext()

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

  const [modelingState, modelingSend] = useMachine(modelingMachine, {
    // context: persistedSettings,
    actions: {
      'Modify AST': () => {},
      'Make selection horizontal': () => {},
      'Make selection vertical': () => {},
      'Update code selection cursors': () => {},
      'show default planes': () => {
        modelingState.context.defaultPlanes?.showPlanes()
      },
    },
    guards: {
      'Can make selection horizontal': () => true,
      'Can make selection vertical': () => true,
      'Selection contains axis': () => true,
      'Selection contains edge': () => true,
      'Selection contains face': () => true,
      'Selection contains line': () => true,
      'Selection contains point': () => true,
      'Selection is empty': () => true,
      'Selection is not empty': () => true,
      'Selection is one face': ({ selectionRanges }) => {
        return !!isCursorInSketchCommandRange(
          engineCommandManager.artifactMap,
          selectionRanges
        )
      },
      'Selection is one or more edges': () => true,
    },
    services: {
      // createSketch: async () => {},
      createLine: async () => {},
      createExtrude: async () => {},
      createFillet: async () => {},
    },
    devTools: true,
  })

  useEffect(() => {
    modelingState.context.defaultPlanes?.onPlaneSelected((plane_id: string) => {
      if (modelingState.nextEvents.includes('Select face')) {
        modelingSend('Select face')
      }
    })
  }, [modelingState.context.defaultPlanes, modelingSend])

  // useStateMachineCommands({
  //   state: settingsState,
  //   send: settingsSend,
  //   commands,
  //   owner: 'settings',
  //   commandBarMeta: settingsCommandBarMeta,
  // })

  return (
    <ModelingMachineContext.Provider
      value={{
        state: modelingState,
        context: modelingState.context,
        send: modelingSend,
      }}
    >
      {/* TODO maybe pass reff down to children/app.ts or render app.tsx directly?
      since realistically it won't ever have generic children that isn't app.tsx */}
      <div className="h-screen overflow-hidden select-none" ref={streamRef}>
        {children}
      </div>
    </ModelingMachineContext.Provider>
  )
}

export default ModelingMachineProvider
