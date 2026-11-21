import { service } from 'plankton'
import type { PluginInstallations } from '@src/lib/communityPlugins/installations'

export const communityPluginsService = service<PluginInstallations>(
  'communityPlugins.installations'
)
