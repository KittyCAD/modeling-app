import type { UserResponse } from '@kittycad/lib'
import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { authMachine } from '@src/machines/authMachine'
import type { ActorRefFrom, SnapshotFrom } from 'xstate'

export type AuthRegistryService = {
  actor: ActorRefFrom<typeof authMachine>
  send: ActorRefFrom<typeof authMachine>['send']
  state: ReadonlySignal<SnapshotFrom<typeof authMachine>>
  token: ReadonlySignal<string>
  user: ReadonlySignal<UserResponse | undefined>
  isLoggedIn: ReadonlySignal<boolean>
  useAuthState: () => SnapshotFrom<typeof authMachine>
  useToken: () => string
  useUser: () => UserResponse | undefined
}

export const authContract = defineContract({
  authService: defineService<AuthRegistryService>('auth.service'),
})

export const { authService } = authContract
