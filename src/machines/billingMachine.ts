import type {
  CustomerBalance,
  Org,
  ZooProductSubscriptions,
} from '@kittycad/lib'
import crossPlatformFetch from '@src/lib/crossPlatformFetch'
import type { ActorRefFrom } from 'xstate'
import { assign, fromPromise, setup } from 'xstate'
import { isErr } from '@src/lib/trap'

const _TIME_1_SECOND = 1000

export enum BillingState {
  Updating = 'updating',
  Waiting = 'waiting',
}

export enum BillingTransition {
  Update = 'update',
  Wait = 'wait',
}

// It's nice to be explicit if we are an Organization, Pro, Free.
// @kittycad/lib offers some types around this, but they aren't as...
// homogeneous: Models['ZooProductSubscriptions_type'], and
// Models['Org_type'].
export enum Tier {
  Free = 'free',
  Pro = 'pro',
  Organization = 'organization',
  Unknown = 'unknown',
}

export type OrgOrError = Org | number | Error
export type SubscriptionsOrError = ZooProductSubscriptions | number | Error
export type TierBasedOn = {
  orgOrError: OrgOrError
  subscriptionsOrError: SubscriptionsOrError
}

export interface BillingContext {
  credits: undefined | number
  allowance: undefined | number
  error: undefined | Error
  urlUserService: () => string
  tier: undefined | Tier
  subscriptionsOrError: undefined | SubscriptionsOrError
  lastFetch: undefined | Date
}

export interface BillingUpdateEvent {
  type: BillingTransition.Update
  apiToken: string
}

export const BILLING_CONTEXT_DEFAULTS: BillingContext = Object.freeze({
  credits: undefined,
  allowance: undefined,
  error: undefined,
  tier: undefined,
  subscriptionsOrError: undefined,
  urlUserService: () => '',
  lastFetch: undefined,
})

const toTierFrom = (args: TierBasedOn): Tier => {
  if (typeof args.orgOrError !== 'number' && !isErr(args.orgOrError)) {
    return Tier.Organization
  } else if (
    typeof args.subscriptionsOrError !== 'number' &&
    !isErr(args.subscriptionsOrError)
  ) {
    const subscriptions: ZooProductSubscriptions = args.subscriptionsOrError
    if (subscriptions.modeling_app.name === 'pro') {
      return Tier.Pro
    } else {
      return Tier.Free
    }
  }

  return Tier.Unknown
}

export const billingMachine = setup({
  types: {
    context: {} as BillingContext,
    input: {} as BillingContext,
    events: {} as BillingUpdateEvent,
  },
  actors: {
    [BillingTransition.Update]: fromPromise(
      async ({
        input,
      }: { input: { context: BillingContext; event: BillingUpdateEvent } }) => {
        // Rate limit on the client side to 1 request per second.
        if (
          input.context.lastFetch &&
          Date.now() - input.context.lastFetch.getTime() < _TIME_1_SECOND
        ) {
          return input.context
        }

        const billingOrError: CustomerBalance | number | Error =
          await crossPlatformFetch(
            `${input.context.urlUserService()}/user/payment/balance`,
            { method: 'GET' },
            input.event.apiToken
          )

        if (typeof billingOrError === 'number' || isErr(billingOrError)) {
          return Promise.reject(billingOrError)
        }
        const billing: CustomerBalance = billingOrError

        const subscriptionsOrError: ZooProductSubscriptions | number | Error =
          await crossPlatformFetch(
            `${input.context.urlUserService()}/user/payment/subscriptions`,
            { method: 'GET' },
            input.event.apiToken
          )

        const orgOrError: Org | number | Error = await crossPlatformFetch(
          `${input.context.urlUserService()}/org`,
          { method: 'GET' },
          input.event.apiToken
        )

        const tier = toTierFrom({
          orgOrError,
          subscriptionsOrError,
        })

        let credits =
          Number(billing.monthly_api_credits_remaining) +
          Number(billing.stable_api_credits_remaining)
        let allowance = undefined

        switch (tier) {
          case Tier.Organization:
          case Tier.Pro:
            credits = Infinity
            break
          case Tier.Free:
            // TS too dumb Tier.Free has the same logic
            if (
              typeof subscriptionsOrError !== 'number' &&
              !isErr(subscriptionsOrError)
            ) {
              allowance = Number(
                subscriptionsOrError.modeling_app
                  .monthly_pay_as_you_go_api_credits
              )
            }
            break
          case Tier.Unknown:
            break
          default:
            const _exh: never = tier
        }

        // If nothing matches, we show a credit total.

        return {
          error: undefined,
          tier,
          subscriptionsOrError,
          credits,
          allowance,
          lastFetch: new Date(),
        }
      }
    ),
  },
}).createMachine({
  initial: BillingState.Waiting,
  context: (args) => args.input,
  states: {
    [BillingState.Waiting]: {
      on: {
        [BillingTransition.Update]: {
          target: BillingState.Updating,
        },
      },
    },
    [BillingState.Updating]: {
      invoke: {
        src: BillingTransition.Update,
        input: (args: {
          context: BillingContext
          event: BillingUpdateEvent
        }) => ({
          context: args.context,
          event: args.event,
        }),
        onDone: [
          {
            target: BillingState.Waiting,
            actions: assign(({ event }) => event.output),
          },
        ],
        // If request failed for billing, go back into waiting state,
        // and signal to the user there's an issue regarding the service.
        onError: [
          {
            target: BillingState.Waiting,
            // Yep, this is hard to follow. XState, why!
            actions: assign({ error: ({ event }) => event.error as Error }),
          },
        ],
      },
    },
  },
})

export type BillingActor = ActorRefFrom<typeof billingMachine>
