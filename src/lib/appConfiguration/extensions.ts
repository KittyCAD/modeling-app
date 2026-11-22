import { factory } from 'plankton'
import { compilePlugin } from '@src/lib/communityPlugins/source'
import {
  createPluginRuntime,
  type PluginRuntime,
} from '@src/lib/communityPlugins/runtime'
import {
  prepareContributions,
  type CommunityContributionAdapter,
} from '@src/lib/communityPlugins/contributions'
import type {
  DevAccountConfigRequest,
  LoadedAccountConfig,
  PreparedAccountExtensions,
} from '@src/lib/appConfiguration/devAccount'
import { isErr } from '@src/lib/trap'

/** Prepared guests have no grants. Graph ownership releases them on replacement or logout. */
export async function prepareAccountExtensions(
  loaded: LoadedAccountConfig,
  sourceIds: readonly string[],
  request: DevAccountConfigRequest,
  adapters: readonly CommunityContributionAdapter[],
  assertCurrent: () => void
): Promise<PreparedAccountExtensions> {
  const runtimes: PluginRuntime[] = []
  const dispose = () => {
    for (const runtime of runtimes) runtime.dispose()
  }
  const extensions: PreparedAccountExtensions['extensions'][number][] = []
  try {
    for (const id of sourceIds) {
      assertCurrent()
      const candidates =
        loaded.sources?.filter((source) => source.id === id) ?? []
      if (candidates.length !== 1)
        return Promise.reject(
          new Error(`Expected one downloaded source for ${id}.`)
        )
      const source = await compilePlugin(candidates[0].contents)
      if (isErr(source)) return Promise.reject(source)
      if (source.manifest.permissions.length)
        return Promise.reject(
          new Error(
            `Configuration extension ${id} requests permissions. This prototype only auto-loads extensions with permissions = [].`
          )
        )
      const runtime = await createPluginRuntime(source, new Set(), () => {})
      if (isErr(runtime)) return Promise.reject(runtime)
      runtimes.push(runtime)
      assertCurrent()
      const items = prepareContributions(
        runtime,
        source.manifest,
        `configuration.${id}`,
        new Set(),
        adapters,
        {
          kind: 'configuration',
          configurationId: request.projectId,
          extensionId: id,
        }
      )
      if (isErr(items)) return Promise.reject(items)
      extensions.push(
        factory({ create: () => ({ items, dispose: runtime.dispose }) })
      )
    }
    return { extensions, dispose }
  } catch (cause) {
    dispose()
    return Promise.reject(cause)
  } finally {
    // Failed preparation never transfers ownership of partially created guests.
    if (extensions.length !== sourceIds.length) dispose()
  }
}
