import type * as UiComponents from '@kittycad/ui-components'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('@kittycad/ui-components', async (importOriginal) => ({
  ...(await importOriginal<typeof UiComponents>()),
  getBillingInfo: vi.fn(),
}))

import {
  BillingError,
  EBillingError,
  getBillingInfo,
  type IBillingInfo,
} from '@kittycad/ui-components'
import { getEstimatedBillingBalance } from '@src/lib/billing/estimate'
import {
  BILLING_CONTEXT_DEFAULTS,
  BillingState,
  BillingTransition,
  billingMachine,
  type BillingActor,
} from '@src/lib/billing/machine'
import { createActor, waitFor } from 'xstate'

let actor: BillingActor
const startedAt = new Date('2026-09-25T12:00:00Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(startedAt)
  vi.mocked(getBillingInfo).mockResolvedValue({
    balance: 590,
    payAsYouGoApiCreditPrice: 0.0083,
    isOrg: false,
    hasSubscription: true,
  })
  actor = createActor(billingMachine, {
    input: {
      ...BILLING_CONTEXT_DEFAULTS,
      balance: 596,
      payAsYouGoApiCreditPrice: 0.0083,
      lastFetch: startedAt,
    },
  }).start()
})

afterEach(() => {
  actor.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function refreshBilling(apiToken = 'test-token') {
  actor.send({ type: BillingTransition.Update, apiToken })
  await vi.advanceTimersByTimeAsync(0)
  await waitFor(actor, (state) => state.matches(BillingState.Waiting))
}

test('finishes a queued update when a prompt ends during a periodic refresh', async () => {
  actor.send({ type: BillingTransition.UsageStarted })
  vi.setSystemTime(new Date('2026-09-25T12:01:00Z'))
  const refresh = Promise.withResolvers<IBillingInfo>()
  vi.mocked(getBillingInfo).mockReturnValueOnce(refresh.promise)
  actor.send({ type: BillingTransition.Update, apiToken: 'test-token' })
  await vi.advanceTimersByTimeAsync(0)
  actor.send({ type: BillingTransition.UsageEnded })
  actor.send({ type: BillingTransition.Update, apiToken: 'test-token' })

  refresh.resolve({
    balance: 596,
    payAsYouGoApiCreditPrice: 0.0083,
    isOrg: false,
    hasSubscription: true,
  })
  await vi.advanceTimersByTimeAsync(0)
  expect(actor.getSnapshot().value).toBe(BillingState.Throttling)
  await vi.advanceTimersByTimeAsync(999)
  expect(getBillingInfo).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(getBillingInfo).toHaveBeenCalledTimes(2)
  expect(actor.getSnapshot().value).toBe(BillingState.Waiting)
  expect(actor.getSnapshot().context.balance).toBe(590)
  expect(actor.getSnapshot().context.pendingUpdateApiToken).toBeUndefined()
  expect(actor.getSnapshot().context.usageStartedAt).toBeUndefined()
  expect(actor.getSnapshot().context.usageEstimateExpiresAt).toBeUndefined()
})

test('coalesces throttled updates and renews the estimate only after a successful fetch', async () => {
  actor.send({ type: BillingTransition.UsageStarted })
  const deadline = actor.getSnapshot().context.usageEstimateExpiresAt
  expect(deadline).toEqual(new Date('2026-09-25T12:20:00Z'))

  vi.setSystemTime(new Date('2026-09-25T12:00:00.500Z'))
  actor.send({ type: BillingTransition.Update, apiToken: 'test-token' })
  await vi.advanceTimersByTimeAsync(499)
  expect(actor.getSnapshot().context.usageEstimateExpiresAt).toEqual(deadline)
  expect(getBillingInfo).not.toHaveBeenCalled()
  actor.send({ type: BillingTransition.Update, apiToken: 'rotated-token' })
  await vi.advanceTimersByTimeAsync(1)
  expect(getBillingInfo).toHaveBeenCalledOnce()
  expect(vi.mocked(getBillingInfo).mock.calls[0][0].token).toBe('rotated-token')
  const refreshedDeadline = new Date('2026-09-25T12:20:01Z')
  expect(actor.getSnapshot().context.usageEstimateExpiresAt).toEqual(
    refreshedDeadline
  )

  vi.setSystemTime(new Date('2026-09-25T12:19:00Z'))
  actor.send({ type: BillingTransition.UsageStarted })
  await refreshBilling('')
  expect(actor.getSnapshot().context.usageEstimateExpiresAt).toEqual(
    refreshedDeadline
  )
  expect(getBillingInfo).toHaveBeenCalledOnce()

  await refreshBilling()
  expect(actor.getSnapshot().context.usageEstimateExpiresAt).toEqual(
    new Date('2026-09-25T12:39:00Z')
  )
  expect(actor.getSnapshot().context.usageAccumulatedMs).toBe(0)
  vi.setSystemTime(new Date('2026-09-25T12:20:00Z'))
  expect(getEstimatedBillingBalance(actor.getSnapshot().context)).toBe(589)
})

test('aborts a hung request, permits a retry, and ignores the late response', async () => {
  const pending = Promise.withResolvers<Response>()
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockReturnValue(pending.promise)
  vi.stubGlobal('fetch', fetch)
  vi.mocked(getBillingInfo).mockImplementationOnce(async (client) => {
    if (!client.fetch) {
      throw new Error('Expected an abortable billing client')
    }
    await client.fetch('https://api.example.test/user/payment/balance')
    return {
      balance: 100,
      payAsYouGoApiCreditPrice: 0.0083,
      isOrg: false,
      hasSubscription: true,
    }
  })
  actor.send({ type: BillingTransition.UsageStarted })
  vi.setSystemTime(new Date('2026-09-25T12:01:00Z'))
  actor.send({ type: BillingTransition.Update, apiToken: 'test-token' })
  await vi.advanceTimersByTimeAsync(0)
  const signal = fetch.mock.calls[0][1]?.signal
  expect(signal?.aborted).toBe(false)

  await vi.advanceTimersByTimeAsync(29_999)
  expect(actor.getSnapshot().value).toBe(BillingState.Updating)
  await vi.advanceTimersByTimeAsync(1)
  expect(actor.getSnapshot().value).toBe(BillingState.Waiting)
  expect(signal?.aborted).toBe(true)
  expect(actor.getSnapshot().context.balance).toBe(596)
  expect(actor.getSnapshot().context.error?.error.type).toBe(
    EBillingError.CatastrophicRequest
  )
  expect(actor.getSnapshot().context.usageEstimateExpiresAt).toEqual(
    new Date('2026-09-25T12:20:00Z')
  )

  vi.setSystemTime(new Date('2026-09-25T12:02:00Z'))
  await refreshBilling()
  expect(actor.getSnapshot().context.balance).toBe(590)
  expect(actor.getSnapshot().context.error).toBeUndefined()
  expect(actor.getSnapshot().context.usageEstimateExpiresAt).toEqual(
    new Date('2026-09-25T12:22:00Z')
  )
  pending.resolve(new Response(null, { status: 200 }))
  await vi.advanceTimersByTimeAsync(0)
  expect(actor.getSnapshot().context.balance).toBe(590)
})

test('expires from the last successful sync despite late starts, interruptions, and failed refreshes', async () => {
  vi.setSystemTime(new Date('2026-09-25T12:10:00Z'))
  actor.send({ type: BillingTransition.UsageStarted })
  expect(actor.getSnapshot().context.usageEstimateExpiresAt).toEqual(
    new Date('2026-09-25T12:20:00Z')
  )
  vi.setSystemTime(new Date('2026-09-25T12:12:00Z'))
  actor.send({ type: BillingTransition.UsageEnded })
  expect(getEstimatedBillingBalance(actor.getSnapshot().context)).toBe(594)

  const error = new BillingError({ type: EBillingError.CatastrophicRequest })
  vi.mocked(getBillingInfo).mockResolvedValueOnce(error)
  vi.setSystemTime(new Date('2026-09-25T12:19:00Z'))
  actor.send({ type: BillingTransition.UsageStarted })
  await refreshBilling()
  expect(actor.getSnapshot().context.error).toBe(error)
  expect(actor.getSnapshot().context.lastFetch).toEqual(startedAt)
  expect(getEstimatedBillingBalance(actor.getSnapshot().context)).toBe(594)
  vi.setSystemTime(new Date('2026-09-25T12:20:00Z'))
  expect(getEstimatedBillingBalance(actor.getSnapshot().context)).toBe(596)

  await refreshBilling()
  expect(actor.getSnapshot().context.error).toBeUndefined()
  expect(actor.getSnapshot().context.usageEstimateExpiresAt).toEqual(
    new Date('2026-09-25T12:40:00Z')
  )
  vi.setSystemTime(new Date('2026-09-25T12:21:00Z'))
  expect(getEstimatedBillingBalance(actor.getSnapshot().context)).toBe(589)
})

test('does not charge the stalled time when usage ends and starts estimating again only after a refresh', async () => {
  actor.send({ type: BillingTransition.UsageStarted })
  vi.setSystemTime(new Date('2026-09-26T07:00:00Z'))
  actor.send({ type: BillingTransition.UsageEnded })
  expect(actor.getSnapshot().context.usageAccumulatedMs).toBe(0)
  expect(getEstimatedBillingBalance(actor.getSnapshot().context)).toBe(596)

  actor.send({ type: BillingTransition.UsageStarted })
  expect(actor.getSnapshot().context.usageEstimateExpiresAt).toEqual(
    new Date('2026-09-25T12:20:00Z')
  )
  actor.send({ type: BillingTransition.UsageEnded })
  await refreshBilling()
  expect(actor.getSnapshot().context.usageEstimateExpiresAt).toBeUndefined()

  actor.send({ type: BillingTransition.UsageStarted })
  expect(actor.getSnapshot().context.usageEstimateExpiresAt).toEqual(
    new Date('2026-09-26T07:20:00Z')
  )
  vi.setSystemTime(new Date('2026-09-26T07:01:00Z'))
  expect(getEstimatedBillingBalance(actor.getSnapshot().context)).toBe(589)
})
