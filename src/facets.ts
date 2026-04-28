import type { StatusBarItemType } from '@src/components/StatusBar/statusBarTypes'
import {
  type ExtensionSettingsContribution,
  mergeExtensionSettings,
  type ResolvedExtensionSettings,
} from '@src/lib/settings/extensionSettings'
import type { RouteObject } from 'react-router-dom'
import { appendFacet, defineFacet } from '@kittycad/extensions'

export const routesFacet = appendFacet<RouteObject>('routes')
export const statusBarGlobalItemsFacet =
  appendFacet<StatusBarItemType>('status-bar-global')
export const statusBarLocalItemsFacet =
  appendFacet<StatusBarItemType>('status-bar-local')

/**
 * App-owned settings extension point.
 *
 * Today the settings actor remains the in-memory source of truth and this facet
 * only contributes extra setting definitions into that model during startup.
 * A follow-up PR can invert that relationship by having core settings
 * contribute through this facet too, then deriving the actor context from the
 * fully resolved facet output.
 */
export const settingsFacet = defineFacet<
  ExtensionSettingsContribution,
  ResolvedExtensionSettings
>({
  name: 'settings',
  defaultValue: {},
  combine: mergeExtensionSettings,
})
