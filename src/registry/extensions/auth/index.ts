import { computed, signal } from '@preact/signals-core'
import {
  clearSessionExpiredNotice,
  sessionExpiredNotice,
} from '@src/lib/sessionExpired'
import { reportRejection } from '@src/lib/trap'
import { authMachine } from '@src/machines/authMachine'
import {
  observations as authObservations,
  type AuthRegistryService,
  type AuthSessionExpiredListener,
  authService,
  authSessionExpiredListenersFacet,
} from '@src/registry/contracts/auth'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import { runtimeService } from '@src/registry/contracts/runtime'
import { createAuthOrganizationState } from '@src/registry/extensions/auth/organization'
import { fileOperationsExtension } from '@src/registry/extensions/fileOperations'
import { observeService } from '@src/registry/inputs'
import { useSelector } from '@xstate/react'
import {
  factory as defineFactory,
  contribute,
  provide,
  type Factory,
} from 'plankton'
import { createActor } from 'xstate'

const expireAuthSession: AuthSessionExpiredListener = ({ auth }) => {
  if (!auth.actor.getSnapshot().matches('loggedIn')) {
    return
  }

  auth.send({ type: 'Session expired' })
}
export const createAuthExtension = (
  files: Factory<{
    operations: FileOperationsRegistryService
  }> = fileOperationsExtension
) =>
  defineFactory({
    dependencies: {
      files,
      auth: authObservations,
      runtime: observeService(runtimeService),
    },
    key: 'auth-extension',
    create: ({ files, auth: authInputs, runtime }) => {
      const fileOperations = Promise.resolve(files.operations)
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
      const organization = createAuthOrganizationState(
        { user, token, isLoggedIn },
        runtime.current
      )

      const serviceImpl: AuthRegistryService = {
        actor: authActor,
        send: (...args: Parameters<typeof authActor.send>) =>
          authActor.send(...args),
        state: authState,
        token,
        user,
        isLoggedIn,
        organization: organization.state,
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
          const listeners = authInputs.authSessionExpiredListenersFacet.value
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
        exports: serviceImpl,
        start: organization.start,
        items: [
          contribute(
            authSessionExpiredListenersFacet,
            () => expireAuthSession,
            {
              key: 'auth-extension:expire-auth-session',
            }
          ),
          provide(authService, serviceImpl),
        ],
        dispose: () => {
          sessionExpiredSubscription()
          authSubscription.unsubscribe()
          authActor.stop()
        },
      }
    },
  }) satisfies Factory
export const authExtension = createAuthExtension()
export default [authExtension]
