import { Registry } from '@kittycad/registry'
import { BillingState, BillingTransition } from '@src/lib/billing/machine'
import billingRegistryItem from '@src/lib/billing/registry'
import { billingService } from '@src/lib/billing/registry/contract'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('billing extension', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
  })

  it('provides billing actor state and context through the registry', () => {
    registry = new Registry()
    registry.configure([billingRegistryItem])

    const billing = registry.get(billingService)

    expect(billing.state.value.matches(BillingState.Waiting)).toBe(true)
    expect(billing.context.value.usageStartedAt).toBeUndefined()

    const send = vi.spyOn(billing.actor, 'send')
    billing.send({ type: BillingTransition.UsageStarted })

    expect(send).toHaveBeenCalledWith({
      type: BillingTransition.UsageStarted,
    })
    expect(billing.context.value.usageStartedAt).toBeInstanceOf(Date)
  })
})
