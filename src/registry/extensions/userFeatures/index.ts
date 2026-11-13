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
import { extension as defineExtension, provide, type Extension } from 'plankton'
import { createActor } from 'xstate'
export const userFeaturesExtension = defineExtension({
  key: 'user-features-extension',
  create: () => {
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
      items: [provide(userFeaturesService, serviceImpl)],
      dispose: () => {
        subscription.unsubscribe()
        actor.stop()
      },
    }
  },
}) satisfies Extension
export default [userFeaturesExtension]
