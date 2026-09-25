import { getEstimatedBillingBalance } from '@src/lib/billing/estimate'
import {
  BILLING_CONTEXT_DEFAULTS,
  BillingState,
  BillingTransition,
  billingMachine,
  type BillingActor,
  type BillingContext,
} from '@src/lib/billing/machine'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createActor, fromPromise, waitFor } from 'xstate'

let actor: BillingActor
const startedAt = new Date('2026-09-25T12:00:00Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(startedAt)
  actor = createActor(
    billingMachine.provide({
      actors: {
        [BillingTransition.Update]: fromPromise(
          async (): Promise<BillingContext> => ({
            ...BILLING_CONTEXT_DEFAULTS,
            balance: 596,
            payAsYouGoApiCreditPrice: 0.0083,
            lastFetch: new Date(),
          })
        ),
      },
    }),
    {
      input: {
        ...BILLING_CONTEXT_DEFAULTS,
        balance: 596,
        payAsYouGoApiCreditPrice: 0.0083,
      },
    }
  ).start()
})

afterEach(() => {
  actor.stop()
  vi.useRealTimers()
})

async function refreshBilling() {
  actor.send({ type: BillingTransition.Update, apiToken: 'test-token' })
  await waitFor(actor, (state) => state.matches(BillingState.Waiting))
}

test('does not extend a running estimate on repeated start events or server refreshes', async () => {
  actor.send({ type: BillingTransition.UsageStarted })
  const deadline = actor.getSnapshot().context.usageEstimateExpiresAt
  expect(deadline).toEqual(new Date('2026-09-25T12:20:00Z'))

  vi.setSystemTime(new Date('2026-09-25T12:19:00Z'))
  actor.send({ type: BillingTransition.UsageStarted })
  await refreshBilling()
  expect(actor.getSnapshot().context.usageEstimateExpiresAt).toEqual(deadline)

  vi.setSystemTime(new Date('2026-09-25T12:19:30Z'))
  expect(getEstimatedBillingBalance(actor.getSnapshot().context)).toBe(595.5)
  vi.setSystemTime(new Date('2026-09-25T12:20:00Z'))
  expect(getEstimatedBillingBalance(actor.getSnapshot().context)).toBe(596)
})

test('does not restart the deadline when usage resumes before billing refreshes', () => {
  actor.send({ type: BillingTransition.UsageStarted })
  vi.setSystemTime(new Date('2026-09-25T12:02:00Z'))
  actor.send({ type: BillingTransition.UsageEnded })
  expect(getEstimatedBillingBalance(actor.getSnapshot().context)).toBe(594)

  vi.setSystemTime(new Date('2026-09-25T12:19:00Z'))
  actor.send({ type: BillingTransition.UsageStarted })
  vi.setSystemTime(new Date('2026-09-25T12:20:00Z'))
  expect(getEstimatedBillingBalance(actor.getSnapshot().context)).toBe(596)
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
  expect(getEstimatedBillingBalance(actor.getSnapshot().context)).toBe(595)
})
