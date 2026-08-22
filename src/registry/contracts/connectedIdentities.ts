import {
  defineContract,
  defineService,
  defineValueSpec,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'

export type ConnectedIdentityStatus =
  | 'connected'
  | 'expired'
  | 'revoked'
  | 'error'

/**
 * Provider-neutral account projection used by registry extensions that need an
 * authenticated identity without depending on a provider-specific auth service.
 */
export type ConnectedIdentity = {
  id: string
  provider: string
  label: string
  handle?: string
  did?: string
  capabilities: readonly string[]
  status: ConnectedIdentityStatus
}

export type ConnectedIdentityProvider = {
  id: string
  title: string
  identities: ReadonlySignal<readonly ConnectedIdentity[]>
  connect?: () => Promise<void>
  disconnect?: (identity: ConnectedIdentity) => Promise<void>
  refresh?: () => Promise<void>
}

export type ConnectedIdentitiesRegistryService = {
  providers: ReadonlySignal<readonly ConnectedIdentityProvider[]>
  identities: ReadonlySignal<readonly ConnectedIdentity[]>
  getIdentities: () => readonly ConnectedIdentity[]
  connect: (providerId: string) => Promise<void>
  disconnect: (identityId: string) => Promise<void>
  refresh: (providerId?: string) => Promise<void>
}

function combineConnectedIdentityProviders(
  providers: readonly ConnectedIdentityProvider[]
) {
  return providers.toSorted((left, right) => left.id.localeCompare(right.id))
}

export const connectedIdentitiesContract = defineContract({
  connectedIdentityProvidersValueSpec: defineValueSpec<
    ConnectedIdentityProvider,
    ConnectedIdentityProvider[]
  >({
    name: 'connected-identity-providers',
    defaultValue: [],
    combine: combineConnectedIdentityProviders,
  }),
  connectedIdentitiesService: defineService<ConnectedIdentitiesRegistryService>(
    'connected-identities.service'
  ),
})

export const {
  connectedIdentityProvidersValueSpec,
  connectedIdentitiesService,
} = connectedIdentitiesContract
