import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { ZDSProject } from '@src/lib/projectSession'
import type { MigrationController } from '@src/lib/kclMigration/controller'

export interface MigrationTurn {
  id: string
  afterExchange: number
  controller: MigrationController
}

export interface KclMigrationService {
  readonly controller: ReadonlySignal<MigrationController | undefined>
  readonly turns: ReadonlySignal<readonly MigrationTurn[]>
  getOrCreate(
    project: ZDSProject,
    create: () => MigrationController
  ): MigrationController | undefined
  start(
    project: ZDSProject,
    create: () => MigrationController,
    afterExchange: number
  ): void
  clearConversation(): void
}

export const { kclMigrationService } = defineContract({
  kclMigrationService: defineService<KclMigrationService>('kcl-migration'),
})
