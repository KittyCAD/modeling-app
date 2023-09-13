import { useMachine } from '@xstate/react'
import { paths } from '../Router'
import React, { createContext, useEffect, useRef } from 'react'
import { setThemeClass, Themes } from 'lib/theme'
import {
  AnyStateMachine,
  ContextFrom,
  InterpreterFrom,
  Prop,
  StateFrom,
} from 'xstate'
import { MODELING_PERSIST_KEY, modelingMachine } from 'machines/modelingMachine'
import { useEngineWithStream } from 'hooks/useEngineWithStream'

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
  const streamRef = useRef<HTMLDivElement>(null)
  useEngineWithStream(streamRef)

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

  // const [modelingState, modelingSend] = useMachine(modelingMachine, {
  //   // context: persistedSettings,
  //   actions: {},
  // })

  // useStateMachineCommands({
  //   state: settingsState,
  //   send: settingsSend,
  //   commands,
  //   owner: 'settings',
  //   commandBarMeta: settingsCommandBarMeta,
  // })

  return (
    // <ModelingMachineContext.Provider
    //   value={{
    //     state: modelingState,
    //     context: modelingState.context,
    //     send: modelingSend,
    //   }}
    // >
    <div
      className="h-screen overflow-hidden select-none"
      ref={streamRef}
    >
      {children}
    </div>
    // </ModelingMachineContext.Provider>
  )
}

export default ModelingMachineProvider
