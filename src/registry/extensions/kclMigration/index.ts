import { defineRegistryItem, provide } from '@kittycad/registry'
import { KclMigrationHeaderItem } from '@src/components/KclMigration'
import { appHeaderItemsValueSpec } from '@src/registry/contracts/appHeader'

export default defineRegistryItem({
  id: 'kcl-migration',
  provides: [
    provide(appHeaderItemsValueSpec, {
      id: 'kcl-migration.open',
      order: 90,
      Component: KclMigrationHeaderItem,
    }),
  ],
})
