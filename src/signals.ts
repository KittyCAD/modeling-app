import type { StatusBarItemType } from '@src/components/StatusBar/statusBarTypes'
import {
  type ExtensionSettingsContribution,
  mergeExtensionSettings,
  type ResolvedExtensionSettings,
} from '@src/lib/settings/extensionSettings'
import type { RouteObject } from 'react-router-dom'
import { appendSignal, defineSignal } from '@kittycad/registry'

export const routesSignal = appendSignal<RouteObject>('routes')
export const statusBarGlobalItemsSignal =
  appendSignal<StatusBarItemType>('status-bar-global')
export const statusBarLocalItemsSignal =
  appendSignal<StatusBarItemType>('status-bar-local')

/**
 * App-owned settings extension point.
 *
 * Today the settings actor remains the in-memory source of truth and this signal
 * only contributes extra setting definitions into that model during startup.
 * A follow-up PR can invert that relationship by having core settings
 * contribute through this signal too, then deriving the actor context from the
 * fully resolved signal output.
 */
export const settingsSignal = defineSignal<
  ExtensionSettingsContribution,
  ResolvedExtensionSettings
>({
  name: 'settings',
  defaultValue: {},
  combine: mergeExtensionSettings,
})
