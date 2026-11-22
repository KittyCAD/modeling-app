import type { SettingDefinition } from '@zoo/zds-plugin'
import { Facet } from 'plankton'

/** Page ownership and stable field IDs are independent of storage categories and editor navigation. */
export interface SettingsPage {
  id: string
  title: string
  owner:
    | { kind: 'extension'; id: string }
    | { kind: 'community'; installationId: string }
  parentId?: string
  fields: Readonly<Record<string, SettingDefinition>>
}

/** Live schemas follow contribution lifetimes; stored user values can outlive their pages. */
export const settingsPagesFacet = new Facet<
  SettingsPage,
  readonly SettingsPage[]
>('settings.pages', (values) => values)
