import { declaredSettings } from '@src/lib/communityPlugins/settings/schema'
import type { CommunityContributionAdapter } from '@src/lib/communityPlugins/contributions'
import { settingsPagesFacet } from '@src/registry/contracts/settingsPages'
import { isErr } from '@src/lib/trap'
import { contribute } from 'plankton'

export const settingsContributionAdapter: CommunityContributionAdapter = {
  kind: 'settings',
  requiredPermissions: [],
  prepare: (_value, { namespace, manifest, owner, contributions }) => {
    const definition = declaredSettings(contributions)
    if (isErr(definition)) return definition
    if (!definition) return new Error('Missing settings declaration.')
    if (owner.kind === 'preview') return []
    if (owner.kind === 'configuration')
      return new Error(
        'Settings pages for configuration extensions are not supported yet.'
      )
    return contribute(settingsPagesFacet, () => ({
      id: `${namespace}.settings`,
      title: manifest.name,
      owner,
      fields: definition.fields,
    }))
  },
}
