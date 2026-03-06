import { describe, expect, it } from 'vitest'
import { getUserBlockedReason } from '@src/components/layout/areas/mlEphantBlockedReason'
import { withSiteBaseURL } from '@src/lib/withBaseURL'

describe('getUserBlockedReason', () => {
  it('returns the api description for missing payment method', () => {
    expect(
      getUserBlockedReason({ block: 'missing_payment_method' } as const)
    ).toBe(
      `You need a payment method to keep using Zookeeper. Go to your [account](${withSiteBaseURL('/account')}) to fix this.`
    )
  })

  it('returns the api description for failed payment method', () => {
    expect(
      getUserBlockedReason({ block: 'payment_method_failed' } as const)
    ).toBe(
      `Your payment method failed. Go to your [account](${withSiteBaseURL('/account')}) to fix this.`
    )
  })

  it('returns undefined when the user is not blocked', () => {
    expect(getUserBlockedReason({ block: null })).toBeUndefined()
    expect(getUserBlockedReason(undefined)).toBeUndefined()
  })
})
