import { useSelector } from '@xstate/react'
import type { ActorRefFrom } from 'xstate'
import { createActor, setup, spawnChild } from 'xstate'

import { createSettings } from '@src/lib/settings/initialSettings'
import { authMachine } from '@src/machines/authMachine'
import {
  engineStreamContextCreate,
  engineStreamMachine,
} from '@src/machines/engineStreamMachine'
import { ACTOR_IDS } from '@src/machines/machineConstants'
import { settingsMachine } from '@src/machines/settingsMachine'

const { AUTH, SETTINGS, ENGINE_STREAM } = ACTOR_IDS
const appMachineActors = {
  [AUTH]: authMachine,
  [SETTINGS]: settingsMachine,
  [ENGINE_STREAM]: engineStreamMachine,
} as const

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
    spawnChild(ENGINE_STREAM, {
      id: ENGINE_STREAM,
      systemId: ENGINE_STREAM,
      input: engineStreamContextCreate(),
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

export const engineStreamActor = appActor.system.get(
  ENGINE_STREAM
) as ActorRefFrom<typeof engineStreamMachine>
