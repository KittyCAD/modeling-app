import { useMachine } from '@xstate/react'
import React, { createContext, useRef } from 'react'
import {
  AnyStateMachine,
  ContextFrom,
  InterpreterFrom,
  Prop,
  StateFrom,
} from 'xstate'
import { modelingMachine } from 'machines/modelingMachine'
import { useSetupEngineManager } from 'hooks/useSetupEngineManager'
import { useCodeEval } from 'hooks/useCodeEval'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'

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
  useCodeEval()

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
      'Selection is one face': () => true,
      'Selection is one or more edges': () => true,
    },
    services: {
      createSketch: async () => {},
      createLine: async () => {},
      createExtrude: async () => {},
      createFillet: async () => {},
    },
    devTools: true,
  })

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
