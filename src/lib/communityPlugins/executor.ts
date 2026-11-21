import {
  compilePlugin,
  matchesPluginSource,
} from '@src/lib/communityPlugins/source'
import { defineExecutorCapability } from '@src/lib/executors/registry/contract'
import { isErr } from '@src/lib/trap'

/** Inspecting a plugin never activates it; the explicit development session consumes successful builds. */
export const pluginCompiler = defineExecutorCapability({
  id: 'communityPlugins.compile',
  matches: matchesPluginSource,
  execute: async (contents: string) => {
    const source = await compilePlugin(contents)
    return isErr(source) ? source : { source }
  },
})
