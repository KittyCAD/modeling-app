import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { computed } from '@preact/signals-core'
import {
  connectedIdentitiesService,
  connectedIdentityProvidersValueSpec,
  type ConnectedIdentitiesRegistryService,
  type ConnectedIdentityProvider,
} from '@src/registry/contracts/connectedIdentities'

function missingProvider(providerId: string): never {
  // eslint-disable-next-line suggest-no-throw/suggest-no-throw
  throw new Error(
    `No connected identity provider is registered for ${providerId}.`
  )
}

function missingIdentity(identityId: string): never {
  // eslint-disable-next-line suggest-no-throw/suggest-no-throw
  throw new Error(`No connected identity is registered for ${identityId}.`)
}

export const connectedIdentitiesExtension = defineRegistryItemFactory((ctx) => {
  const providers = ctx.valueSpecs.signal(connectedIdentityProvidersValueSpec)
  const identities = computed(() =>
    providers.value.flatMap((provider) => provider.identities.value)
  )

  const getProvider = (providerId: string) => {
    const provider = providers.value.find(
      (candidate) => candidate.id === providerId
    )
    if (!provider) {
      missingProvider(providerId)
    }
    return provider
  }

  const serviceImpl: ConnectedIdentitiesRegistryService = {
    providers,
    identities,
    getIdentities: () => identities.value,
    connect: async (providerId) => {
      const provider = getProvider(providerId)
      await provider.connect?.()
    },
    disconnect: async (identityId) => {
      for (const provider of providers.value) {
        const identity = provider.identities.value.find(
          (candidate) => candidate.id === identityId
        )
        if (identity) {
          await provider.disconnect?.(identity)
          return
        }
      }
      missingIdentity(identityId)
    },
    refresh: async (providerId) => {
      const targets: readonly ConnectedIdentityProvider[] = providerId
        ? [getProvider(providerId)]
        : providers.value
      await Promise.all(targets.map((provider) => provider.refresh?.()))
    },
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'connected-identities-extension',
      providesServices: [
        provideService(connectedIdentitiesService, serviceImpl),
      ],
    }),
  }
}, 'connected-identities-extension')

export default defineRegistryItem({
  id: 'connected-identities',
  uses: [connectedIdentitiesExtension],
})
