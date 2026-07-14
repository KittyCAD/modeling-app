import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals-core'
import { authMachine } from '@src/machines/authMachine'
import {
  type AuthRegistryService,
  authService,
} from '@src/registry/contracts/auth'
import { useSelector } from '@xstate/react'
import { createActor } from 'xstate'

export const authExtension = defineRegistryItemFactory(() => {
  const authActor = createActor(authMachine).start()
  const authState = signal(authActor.getSnapshot())
  const authSubscription = authActor.subscribe((snapshot) => {
    authState.value = snapshot
  })
  const token = computed(() => authState.value.context.token)
  const user = computed(() => authState.value.context.user)
  const isLoggedIn = computed(() => authState.value.matches('loggedIn'))

  const serviceImpl: AuthRegistryService = {
    actor: authActor,
    send: (...args: Parameters<typeof authActor.send>) =>
      authActor.send(...args),
    state: authState,
    token,
    user,
    isLoggedIn,
    useAuthState: () => useSelector(authActor, (state) => state),
    useToken: () => useSelector(authActor, (state) => state.context.token),
    useUser: () => useSelector(authActor, (state) => state.context.user),
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'auth-extension',
      providesServices: [provideService(authService, serviceImpl)],
      dispose: () => {
        authSubscription.unsubscribe()
        authActor.stop()
      },
    }),
  }
}, 'auth-extension')

export default defineRegistryItem({
  id: 'auth',
  uses: [authExtension],
})
