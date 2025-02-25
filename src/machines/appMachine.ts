import { ActorRefFrom, assign, createActor, setup, spawnChild } from 'xstate'
import { authMachine } from './authMachine'
import { useSelector } from '@xstate/react'
import { ACTOR_IDS } from './machineConstants'
import { settingsMachine } from './settingsMachine'
import { createSettings } from 'lib/settings/initialSettings'

const { AUTH, SETTINGS } = ACTOR_IDS
const appMachineActors = {
  [AUTH]: authMachine,
  [SETTINGS]: settingsMachine,
} as const

type AppMachineActors = {
  [K in keyof typeof appMachineActors]: ActorRefFrom<
    (typeof appMachineActors)[K]
  >
}

const appMachine = setup({
  actors: appMachineActors,
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5gF8A0IB2B7CdGgAoBbAQwGMALASwzAEp8QAHLWKgFyqw0YA9EAjACZ0AT0FDkU5EA */
  id: 'modeling-app',
  entry: [
    spawnChild(AUTH, { id: AUTH, systemId: AUTH }),
    spawnChild(SETTINGS, {
      id: SETTINGS,
      systemId: SETTINGS,
      input: createSettings(),
    }),
  ],
})

export const appActor = createActor(appMachine)
export const authActor = appActor.system.get(AUTH) as ActorRefFrom<
  typeof authMachine
>
export const useAuthState = () => useSelector(authActor, (state) => state)
export const useToken = () =>
  useSelector(authActor, (state) => state.context.token)
export const useUser = () =>
  useSelector(authActor, (state) => state.context.user)

export const settingsActor = appActor.system.get(SETTINGS) as ActorRefFrom<
  typeof settingsMachine
>
export const getSettings = () => {
  const { currentProject: _, ...settings } = settingsActor.getSnapshot().context
  return settings
}
export const useSettings = () =>
  useSelector(settingsActor, (state) => {
    // We have to peel everything that isn't settings off
    const { currentProject, ...settings } = state.context
    return settings
  })
