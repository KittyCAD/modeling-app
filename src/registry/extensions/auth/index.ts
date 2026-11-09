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
  authSessionExpiredListenersFacet,
} from '@src/registry/contracts/auth'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { useSelector } from '@xstate/react'
import { contribute, provide, type Subtree } from 'plankton'
import { createActor } from 'xstate'

const expireAuthSession: AuthSessionExpiredListener = ({ auth }) => {
  if (!auth.actor.getSnapshot().matches('loggedIn')) {
    return
  }

  auth.send({ type: 'Session expired' })
}
export const authExtension = {
  key: 'auth-extension',
  create: (ctx) => {
    // Defer service resolution until registry graph construction has completed.
    const fileOperations = Promise.resolve().then(() =>
      ctx.required(fileOperationsService)
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
        const listeners = ctx.observe(authSessionExpiredListenersFacet).value
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
      items: [
        contribute(authSessionExpiredListenersFacet, () => expireAuthSession, {
          key: 'auth-extension:expire-auth-session',
        }),
        provide(authService, serviceImpl),
      ],
      dispose: () => {
        sessionExpiredSubscription()
        authSubscription.unsubscribe()
        authActor.stop()
      },
    }
  },
} satisfies Subtree
export default [authExtension]
