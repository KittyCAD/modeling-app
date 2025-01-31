import { ActorRefFrom, createActor, setup } from 'xstate'
import { authMachine } from './authMachine'
import { useSelector } from '@xstate/react'
import { ACTOR_IDS } from './machineConstants'

const appMachine = setup({
  actors: {
    [ACTOR_IDS.AUTH]: authMachine,
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5gF8A0IB2B7CdGgAoBbAQwGMALASwzAEp8QAHLWKgFyqw0YA9EAjACZ0AT0FDkU5EA */
  id: 'modeling-app',
  invoke: [
    {
      src: ACTOR_IDS.AUTH,
      systemId: ACTOR_IDS.AUTH,
    },
  ],
})

export const appActor = createActor(appMachine).start()

export const authActor = appActor.system.get(ACTOR_IDS.AUTH) as ActorRefFrom<
  typeof authMachine
>
export const useAuthState = () => useSelector(authActor, (state) => state)
export const useToken = () =>
  useSelector(authActor, (state) => state.context.token)
export const useUser = () =>
  useSelector(authActor, (state) => state.context.user)
