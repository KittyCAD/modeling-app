import { defineContract, defineService } from '@kittycad/registry'
import type { Signal } from '@preact/signals-core'
import type { RollbackEditSession } from '@src/lang/modifyAst/rollback'

export interface OpenCascadeRollbackEditService {
  readonly session: Signal<RollbackEditSession | undefined>
  begin(session: RollbackEditSession): void
  markManual(): void
  consumeTemporary(): RollbackEditSession | undefined
  clear(): void
}

export const openCascadeRollbackEditContract = defineContract({
  openCascadeRollbackEditService: defineService<OpenCascadeRollbackEditService>(
    'open-cascade-rollback-edit'
  ),
})

export const { openCascadeRollbackEditService } =
  openCascadeRollbackEditContract
