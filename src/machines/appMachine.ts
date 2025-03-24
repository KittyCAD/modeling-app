import { useSelector } from '@xstate/react'
import type { ActorRefFrom } from 'xstate'
import { createActor, setup, spawnChild } from 'xstate'

import { createSettings } from '@src/lib/settings/initialSettings'
import { authMachine } from '@src/machines/authMachine'
import { ACTOR_IDS } from '@src/machines/machineConstants'
import { settingsMachine } from '@src/machines/settingsMachine'

const { AUTH, SETTINGS } = ACTOR_IDS
const appMachineActors = {
  [AUTH]: authMachine,
  [SETTINGS]: settingsMachine,
} as const

const appMachine = setup({
  types: {} as {
    children: {
      auth: typeof AUTH
      settings: typeof SETTINGS
    }
  },
  actors: appMachineActors,
}).createMachine({
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
export const authActor = appActor.getSnapshot().children.auth!
export const useAuthState = () => useSelector(authActor, (state) => state)
export const useToken = () =>
  useSelector(authActor, (state) => state.context.token)
export const useUser = () =>
  useSelector(authActor, (state) => state.context.user)

export const settingsActor = appActor.getSnapshot().children.settings!
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
