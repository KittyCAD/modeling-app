import { Registry } from '@kittycad/registry'
import { kclMigrationService } from '@src/registry/contracts/kclMigration'
import kclMigration from '@src/registry/extensions/kclMigration'
import { expect, it } from 'vitest'

it('registers without reading project or auth services during graph construction', () => {
  using registry = new Registry()
  registry.configure([kclMigration])
  expect(registry.get(kclMigrationService).controller.value).toBeUndefined()
})
