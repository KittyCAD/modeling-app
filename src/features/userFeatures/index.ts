import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { computed, effect } from '@preact/signals'
import { authService } from '@src/contracts/auth'
import { userFeaturesService } from '@src/contracts/userFeatures'
import { createUserFeaturesService } from '@src/features/userFeatures/createUserFeaturesService'
import { fetchUserFeatures } from '@src/features/userFeatures/featuresApi'

/**
 * Which features this account has, as answered by the API.
 *
 * Its own feature rather than part of auth, because the two answer different
 * questions and fail separately: auth says who you are, this says what your
 * account is allowed to see, and a features fetch that fails must not make you
 * look signed out. It follows the token because that is the only input it has.
 *
 * Nothing here knows what any particular feature *means*. A feature that gates
 * KCL's parser is projected into runtime flags by the KCL feature; one that gates
 * an agent is read by the agent. Putting the interpretation here would make this
 * the place every gated feature has to edit, which is the thing the registry
 * exists to avoid.
 */
export default defineRegistryItemFactory((ctx) => {
  // Lazy: the body of this computed runs when it is first read, which is inside
  // the effect below — after the graph has been flattened.
  const token = computed(() => ctx.services.get(authService).token.value)

  const features = createUserFeaturesService({
    token,
    fetchFeatures: fetchUserFeatures,
  })

  /**
   * Follow the token.
   *
   * Deferred by a microtask because an effect runs its body on creation, and at
   * construction time the service graph is still being built — the second rule
   * the container enforces.
   */
  let stopFollowing = () => {}
  queueMicrotask(() => {
    stopFollowing = effect(() => features.sync())
  })

  return {
    model: features,
    item: defineRuntimeRegistryItem({
      id: 'userFeatures',
      dispose: () => {
        stopFollowing()
        features.dispose()
      },
      providesServices: [provideService(userFeaturesService, features)],
    }),
  }
}, 'userFeatures')
