import type { UserFeature } from '@kittycad/lib'
import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { UserFeaturesContext } from '@src/machines/userFeaturesMachine'

export type UserFeaturesRegistryService = {
  context: ReadonlySignal<UserFeaturesContext>
  has: (featureFlagId: UserFeature, defaultValue: boolean) => boolean
}

export const userFeaturesContract = defineContract({
  userFeaturesService:
    defineService<UserFeaturesRegistryService>('user-features'),
})

export const { userFeaturesService } = userFeaturesContract
