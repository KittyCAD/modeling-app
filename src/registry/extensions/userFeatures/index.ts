import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals-core'
import {
  UserFeaturesState,
  userFeaturesContextHas,
  userFeaturesMachine,
} from '@src/machines/userFeaturesMachine'
import {
  type UserFeaturesRegistryService,
  userFeaturesService,
} from '@src/registry/contracts/userFeatures'
import { useSelector } from '@xstate/react'
import { createActor } from 'xstate'

export const userFeaturesExtension = defineRegistryItemFactory(() => {
  const actor = createActor(userFeaturesMachine).start()
  const state = signal(actor.getSnapshot())
  const context = signal(actor.getSnapshot().context)
  const subscription = actor.subscribe((snapshot) => {
    state.value = snapshot
    context.value = snapshot.context
  })
  const ready = computed(() => state.value.matches(UserFeaturesState.Ready))

  const serviceImpl: UserFeaturesRegistryService = {
    actor,
    send: (...args: Parameters<typeof actor.send>) => actor.send(...args),
    state,
    context,
    contextSignal: context,
    ready,
    has: (featureFlagId, defaultValue) =>
      userFeaturesContextHas(context.value, featureFlagId, defaultValue),
    useContext: () => useSelector(actor, ({ context }) => context),
    useHas: (featureFlagId, defaultValue) =>
      useSelector(actor, ({ context }) =>
        userFeaturesContextHas(context, featureFlagId, defaultValue)
      ),
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'user-features-extension',
      providesServices: [provideService(userFeaturesService, serviceImpl)],
      dispose: () => {
        subscription.unsubscribe()
        actor.stop()
      },
    }),
  }
}, 'user-features-extension')

export default defineRegistryItem({
  id: 'user-features',
  uses: [userFeaturesExtension],
})
