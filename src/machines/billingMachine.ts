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

export const BILLING_CONTEXT_DEFAULTS: BillingContext = Object.freeze({
  credits: undefined,
  allowance: undefined,
  error: undefined,
  urlUserService: '',
})

export const toBillingSubscriptionName = (
  str: string
): BillingSubscriptionName => {
  return Object.values(BillingSubscriptionName).includes(str)
    ? BillingSubscriptionName[str]
    : BillingSubscriptionName.Unknown
}

export const billingMachine = setup({
  types: {
    context: {} as BillingContext,
    input: {} as BillingContext,
  },
  actors: {
    [BillingTransition.Update]: fromPromise(
      async ({ input }: { input: { context: BillingContext } }) => {
        const billingOrError = await fetch(
          `${input.context.urlUserService}/user/payment/balance`,
          { credentials: 'include' }
        )
          .then((resp) =>
            resp.ok ? resp.json() : new Error(resp.statusText || resp.status)
          )
          .catch((e) => new Error(e))

        if (billingOrError instanceof Error) {
          return {
            error: billingOrError,
          }
        }

        const billing = billingOrError

        const plan: BillingSubscriptionName = toBillingSubscriptionName(
          billing.subscription_details.modeling_app.name
        )
        let credits = undefined
        let allowance = undefined
        switch (plan) {
          case BillingSubscriptionName.Pro:
          case BillingSubscriptionName.Enterprise:
            credits = Infinity
            break
          case BillingSubscriptionName.Free:
            credits =
              Number(dataBilling.monthly_credits_remaining) +
              Number(billing.pre_pay_credits_remaining)
            // jess: this is monthly allowance. lee: but the name? jess: i know names computer science hard
            allowance = Number(
              dataBilling.subscription_details.modeling_app
                .pay_as_you_go_credits
            )
            break
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
  initial: BillingState.Updating,
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
        input: ({ context }) => ({ context }),
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
            actions: assign(({ event }) => event.output),
          },
        ],
      },
    },
  },
})

export type BillingActor = ActorRefFrom<typeof billingMachine>
