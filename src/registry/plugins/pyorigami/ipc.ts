import type { AuthoringOutput } from '@src/lib/pyorigami/authoringTypes'
import type { PluginIpcChannel } from '@src/registry/pluginIpc'

export const PYORIGAMI_PLUGIN_ID = 'pyorigami'
export const PYORIGAMI_RENDER_CHANNEL =
  'plugin:pyorigami.render' satisfies PluginIpcChannel
export const PYORIGAMI_AUTHOR_CHANNEL =
  'plugin:pyorigami.author' satisfies PluginIpcChannel
export type PyorigamiAuthorResult =
  | { ok: true; contents: string }
  | { ok: false; error: string }
export const PYORIGAMI_CANCEL_CHANNEL =
  'plugin:pyorigami.cancel' satisfies PluginIpcChannel

/** A run returns all diagram pages, rather than silently truncating to page one. */
export type PyorigamiRenderResult =
  | { ok: true; pages: string[]; authoring?: AuthoringOutput }
  | { ok: false; error: string }
