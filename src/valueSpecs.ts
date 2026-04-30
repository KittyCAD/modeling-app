import type { StatusBarItemType } from '@src/components/StatusBar/statusBarTypes'
import {
  type ExtensionSettingsContribution,
  mergeExtensionSettings,
  type ResolvedExtensionSettings,
} from '@src/lib/settings/extensionSettings'
import type { RouteObject } from 'react-router-dom'
import { appendValueSpec, defineValueSpec } from '@kittycad/registry'

export const routesValueSpec = appendValueSpec<RouteObject>('routes')
export const statusBarGlobalItemsValueSpec =
  appendValueSpec<StatusBarItemType>('status-bar-global')
export const statusBarLocalItemsValueSpec =
  appendValueSpec<StatusBarItemType>('status-bar-local')

/**
 * App-owned settings extension point.
 *
 * Today the settings actor remains the in-memory source of truth and this value spec
 * only contributes extra setting definitions into that model during startup.
 * A follow-up PR can invert that relationship by having core settings
 * contribute through this value spec too, then deriving the actor context from the
 * fully resolved value-spec output.
 */
export const settingsValueSpec = defineValueSpec<
  ExtensionSettingsContribution,
  ResolvedExtensionSettings
>({
  name: 'settings',
  defaultValue: {},
  combine: mergeExtensionSettings,
})
