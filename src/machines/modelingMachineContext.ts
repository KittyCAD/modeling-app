import { createContext, type MutableRefObject } from 'react'
import type { Actor, ContextFrom, Prop, StateFrom } from 'xstate'
import type { modelingMachine } from '@src/machines/modelingMachine'
import type { Project } from '@src/lib/project'

/** React presentation borrows the actor owned by its route or editor view. */
export interface ModelingMachineContextValue {
  state: StateFrom<typeof modelingMachine>
  context: ContextFrom<typeof modelingMachine>
  send: Prop<Actor<typeof modelingMachine>, 'send'>
  actor: Actor<typeof modelingMachine>
  theProject: MutableRefObject<Project | undefined>
}
export const ModelingMachineContext = createContext(
  {} as ModelingMachineContextValue
)
