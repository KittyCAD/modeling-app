import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type {
  BillingActor,
  BillingContext,
  billingMachine,
} from '@src/lib/billing/machine'
import type { SnapshotFrom } from 'xstate'

export type BillingRegistryService = {
  actor: BillingActor
  send: BillingActor['send']
  state: ReadonlySignal<SnapshotFrom<typeof billingMachine>>
  context: ReadonlySignal<BillingContext>
  useContext: () => BillingContext
}

export const billingContract = defineContract({
  billingService: defineService<BillingRegistryService>('billing.service'),
})

export const { billingService } = billingContract
