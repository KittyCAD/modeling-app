import type { PluginRuntime } from '@src/lib/communityPlugins/runtime'
import type { PluginManifest } from '@src/lib/communityPlugins/source'
import { isErr } from '@src/lib/trap'
import { Facet, type Extension } from 'plankton'

/** Trusted core features own parsing and adaptation of each public contribution point. */
export interface CommunityContributionAdapter {
  kind: string
  requiredPermissions: readonly string[]
  prepare: (
    definition: unknown,
    context: {
      namespace: string
      manifest: PluginManifest
      invoke: (callback: number) => Error | undefined
    }
  ) => Extension | Error
}

export const communityContributionAdaptersFacet = new Facet<
  CommunityContributionAdapter,
  readonly CommunityContributionAdapter[]
>('communityPlugins.contributionAdapters', (values) => values)

export function prepareContributions(
  runtime: PluginRuntime,
  manifest: PluginManifest,
  namespace: string,
  grants: ReadonlySet<string>,
  adapters: readonly CommunityContributionAdapter[]
): Extension[] | Error {
  const items: Extension[] = []
  for (const contribution of runtime.contributions) {
    const matches = adapters.filter(
      (adapter) => adapter.kind === contribution.kind
    )
    if (matches.length !== 1)
      return new Error(`Expected one adapter for ${contribution.kind}`)
    const adapter = matches[0]
    if (
      adapter.requiredPermissions.some(
        (permission) =>
          !manifest.permissions.includes(permission) || !grants.has(permission)
      )
    ) {
      return new Error(
        `Permission denied for contribution: ${contribution.kind}`
      )
    }
    const item = adapter.prepare(contribution.definition, {
      namespace,
      manifest,
      invoke: runtime.invoke,
    })
    if (isErr(item)) return item
    items.push(item)
  }
  return items
}
