import { defineContract, defineService } from '@kittycad/registry'
import type { BillingActor } from '@src/machines/billingMachine'

export type BillingRegistryService = {
  actor: BillingActor
  send: BillingActor['send']
}

export const billingContract = defineContract({
  billingService: defineService<BillingRegistryService>('billing.service'),
})

export const { billingService } = billingContract
