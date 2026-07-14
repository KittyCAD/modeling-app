import type { Feature } from '@kittycad/lib'
import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type {
  UserFeaturesActorRef,
  UserFeaturesContext,
  UserFeaturesService,
  userFeaturesMachine,
} from '@src/machines/userFeaturesMachine'
import type { SnapshotFrom } from 'xstate'

export type UserFeaturesRegistryService = UserFeaturesService & {
  actor: UserFeaturesActorRef
  send: UserFeaturesActorRef['send']
  state: ReadonlySignal<SnapshotFrom<typeof userFeaturesMachine>>
  context: ReadonlySignal<UserFeaturesContext>
  contextSignal: ReadonlySignal<UserFeaturesContext>
  ready: ReadonlySignal<boolean>
  useContext: () => UserFeaturesContext
  useHas: (featureFlagId: Feature, defaultValue: boolean) => boolean
}

export const userFeaturesContract = defineContract({
  userFeaturesService:
    defineService<UserFeaturesRegistryService>('user-features'),
})

export const { userFeaturesService } = userFeaturesContract
