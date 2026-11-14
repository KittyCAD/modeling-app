import { inputs, observeService } from '@src/registry/inputs'
import type { ReadonlySignal } from '@preact/signals-core'
import type {
  BillingActor,
  BillingContext,
  billingMachine,
} from '@src/lib/billing/machine'
import { contract, service } from 'plankton'
import type { SnapshotFrom } from 'xstate'

export type BillingRegistryService = {
  actor: BillingActor
  send: BillingActor['send']
  state: ReadonlySignal<SnapshotFrom<typeof billingMachine>>
  context: ReadonlySignal<BillingContext>
  useContext: () => BillingContext
}
export const billingContract = contract({
  billingService: service<BillingRegistryService>('billing.service'),
})

export const { billingService } = billingContract

export const observations = inputs({
  billingService: observeService(billingService),
})
