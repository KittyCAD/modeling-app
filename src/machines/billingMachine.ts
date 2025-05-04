import { Models } from '@kittycad/lib'
import crossPlatformFetch from '@src/lib/crossPlatformFetch'
import type { ActorRefFrom } from 'xstate'
import { assign, fromPromise, setup } from 'xstate'

export enum BillingSubscriptionName {
  Free = 'free',
  Pro = 'pro',
  Enterprise = 'enterprise',
  Unknown = 'unknown',
}

export enum BillingState {
  Updating = 'updating',
  Waiting = 'waiting',
}

export enum BillingTransition {
  Update = 'update',
  Wait = 'wait',
}

export interface BillingContext {
  credits: undefined | number
  allowance: undefined | number
  error: undefined | Error
  urlUserService: string
}

export interface BillingUpdateEvent {
  type: BillingTransition.Update
  apiToken: string
}

export const BILLING_CONTEXT_DEFAULTS: BillingContext = Object.freeze({
  credits: undefined,
  allowance: undefined,
  error: undefined,
  urlUserService: '',
})

export const toBillingSubscriptionName = (
  target: string
): BillingSubscriptionName => {
  return (
    Object.values(BillingSubscriptionName).find((item) => item === target) ??
    BillingSubscriptionName.Unknown
  )
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
        const billingOrError: Models['CustomerBalance_type'] | Error =
          await crossPlatformFetch(
            `${input.context.urlUserService}/user/payment/balance`,
            { method: 'GET' },
            input.event.apiToken
          )

        if (billingOrError instanceof Error) {
          return Promise.reject(billingOrError)
        }

        const billing: Models['CustomerBalance_type'] = billingOrError

        const plan: BillingSubscriptionName = toBillingSubscriptionName(
          billing.subscription_details?.modeling_app.name ?? ''
        )

        let credits =
          Number(billing.monthly_credits_remaining) +
          Number(billing.pre_pay_credits_remaining)
        let allowance = undefined
        switch (plan) {
          case BillingSubscriptionName.Pro:
          case BillingSubscriptionName.Enterprise:
            credits = Infinity
            break
          case BillingSubscriptionName.Free:
            // jess: this is monthly allowance. lee: but the name? jess: i know names computer science hard
            allowance = Number(
              billing.subscription_details?.modeling_app.pay_as_you_go_credits
            )
            break
          // On unknown, we can still show the total credits (graceful degradation).
          case BillingSubscriptionName.Unknown:
            break
          default:
            const _exh: never = plan
        }

        return {
          error: undefined,
          credits,
          allowance,
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
