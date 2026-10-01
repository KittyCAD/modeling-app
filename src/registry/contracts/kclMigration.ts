import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { ZDSProject } from '@src/lang/KclManager'
import type { MigrationController } from '@src/lib/kclMigration/controller'

export interface KclMigrationService {
  readonly controller: ReadonlySignal<MigrationController | undefined>
  getOrCreate(
    project: ZDSProject,
    create: () => MigrationController
  ): MigrationController | undefined
}

export const { kclMigrationService } = defineContract({
  kclMigrationService: defineService<KclMigrationService>('kcl-migration'),
})
