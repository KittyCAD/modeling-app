import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { ZDSProject } from '@src/lib/projectSession'
import type { MigrationController } from '@src/lib/kclMigration/controller'
import type {
  MigrationConversation,
  MigrationConversationLink,
} from '@src/lib/kclMigration/conversation'

export interface MigrationTurn {
  id: string
  afterExchange: number
  controller: MigrationController
  conversationId?: string
}

export interface KclMigrationService {
  readonly history: MigrationConversation
  readonly controller: ReadonlySignal<MigrationController | undefined>
  readonly turns: ReadonlySignal<readonly MigrationTurn[]>
  getOrCreate(
    project: ZDSProject,
    create: () => MigrationController
  ): MigrationController | undefined
  start(
    project: ZDSProject,
    create: () => MigrationController,
    afterExchange: number,
    conversation?: MigrationConversationLink
  ): void
  clearConversation(): void
}

export const { kclMigrationService } = defineContract({
  kclMigrationService: defineService<KclMigrationService>('kcl-migration'),
})
