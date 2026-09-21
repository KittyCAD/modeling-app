import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals-core'
import {
  clearSessionExpiredNotice,
  sessionExpiredNotice,
} from '@src/lib/sessionExpired'
import { reportRejection } from '@src/lib/trap'
import { authMachine } from '@src/machines/authMachine'
import {
  type AuthRegistryService,
  type AuthSessionExpiredListener,
  authService,
  authSessionExpiredListenersValueSpec,
} from '@src/registry/contracts/auth'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { useSelector } from '@xstate/react'
import { createActor } from 'xstate'

const expireAuthSession: AuthSessionExpiredListener = ({ auth }) => {
  if (!auth.actor.getSnapshot().matches('loggedIn')) {
    return
  }

  auth.send({ type: 'Session expired' })
}

export const authExtension = defineRegistryItemFactory((ctx) => {
  // Defer service resolution until registry graph construction has completed.
  const fileOperations = Promise.resolve().then(() =>
    ctx.services.get(fileOperationsService)
  )
  const authActor = createActor(authMachine, {
    input: { fileOperations },
  }).start()
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
    sessionExpiredNotice,
    clearSessionExpiredNotice,
    useAuthState: () => useSelector(authActor, (state) => state),
    useToken: () => useSelector(authActor, (state) => state.context.token),
    useUser: () => useSelector(authActor, (state) => state.context.user),
  }
  let lastHandledSessionExpiredNotice = sessionExpiredNotice.peek()
  const sessionExpiredSubscription = sessionExpiredNotice.subscribe(
    (notice) => {
      if (!notice || notice === lastHandledSessionExpiredNotice) {
        return
      }
      lastHandledSessionExpiredNotice = notice

      const listeners = ctx.valueSpecs.get(authSessionExpiredListenersValueSpec)
      for (const listener of listeners) {
        try {
          listener({ auth: serviceImpl, notice })
        } catch (error) {
          reportRejection(error)
        }
      }
    }
  )

  return {
    item: defineRuntimeRegistryItem({
      id: 'auth-extension',
      provides: [
        provide(authSessionExpiredListenersValueSpec, expireAuthSession, {
          key: 'auth-extension:expire-auth-session',
        }),
      ],
      providesServices: [provideService(authService, serviceImpl)],
      dispose: () => {
        sessionExpiredSubscription()
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
