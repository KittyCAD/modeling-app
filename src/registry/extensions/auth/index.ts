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
  type AuthSessionExpiredListener,
  type AuthRegistryService,
  authSessionExpiredListenersValueSpec,
  authService,
} from '@src/registry/contracts/auth'
import {
  type ConnectedIdentity,
  connectedIdentityProvidersValueSpec,
} from '@src/registry/contracts/connectedIdentities'
import { useSelector } from '@xstate/react'
import { createActor } from 'xstate'

const expireAuthSession: AuthSessionExpiredListener = ({ auth }) => {
  if (!auth.actor.getSnapshot().matches('loggedIn')) {
    return
  }

  auth.send({ type: 'Session expired' })
}

export function getZooIdentityLabel(
  user: NonNullable<AuthRegistryService['user']['value']>
) {
  if (user.name) {
    return user.name
  }
  if (user.first_name) {
    return user.last_name
      ? `${user.first_name} ${user.last_name}`
      : user.first_name
  }
  return user.email || 'Zoo account'
}

export function zooConnectedIdentityFromUser(
  user: NonNullable<AuthRegistryService['user']['value']>
): ConnectedIdentity {
  return {
    id: `zoo:${user.id}`,
    provider: 'zoo',
    label: getZooIdentityLabel(user),
    handle: user.email,
    capabilities: ['zoo:auth', 'projects:read', 'projects:write'],
    status: 'connected',
  }
}

export const authExtension = defineRegistryItemFactory((ctx) => {
  const authActor = createActor(authMachine).start()
  const authState = signal(authActor.getSnapshot())
  const authSubscription = authActor.subscribe((snapshot) => {
    authState.value = snapshot
  })
  const token = computed(() => authState.value.context.token)
  const user = computed(() => authState.value.context.user)
  const isLoggedIn = computed(() => authState.value.matches('loggedIn'))
  const zooConnectedIdentities = computed(() => {
    const currentUser = user.value
    if (!isLoggedIn.value || !currentUser) {
      return []
    }

    return [zooConnectedIdentityFromUser(currentUser)]
  })

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
        provide(
          connectedIdentityProvidersValueSpec,
          {
            id: 'zoo',
            title: 'Zoo',
            identities: zooConnectedIdentities,
            disconnect: async () => {
              authActor.send({ type: 'Log out' })
            },
          },
          {
            key: 'auth-extension:zoo-connected-identity-provider',
          }
        ),
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
