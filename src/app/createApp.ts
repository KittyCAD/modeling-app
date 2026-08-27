import { Registry, type RegistryItem } from '@kittycad/registry'
import type { App } from '@src/app/context'
import {
  appOverridesSlot,
  appServicesSlot,
  featureRegistryItems,
} from '@src/app/registryItems'

export interface CreateAppOptions {
  /** Extra items, installed after the discovered features. */
  items?: readonly RegistryItem[]
  /** Items that replace discovered ones. Installed last so they win. */
  overrides?: readonly RegistryItem[]
}

/**
 * Build the application.
 *
 * The whole composition root. There is no import order to get right and no
 * initialisation sequence to maintain: features declare what they provide and
 * what they need, and the registry resolves the graph lazily on first read.
 * A service that is never read is never constructed.
 */
export function createApp(options: CreateAppOptions = {}): App {
  const registry = new Registry()

  registry.configure([
    ...featureRegistryItems,
    appServicesSlot.of(...(options.items ?? [])),
    appOverridesSlot.of(...(options.overrides ?? [])),
  ])

  return {
    registry,
    dispose: () => registry[Symbol.dispose](),
  }
}
