import type { Models } from '@kittycad/lib'
import crossPlatformFetch from '@src/lib/crossPlatformFetch'
import type { ActorRefFrom } from 'xstate'
import { assign, fromPromise, setup } from 'xstate'

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
        const billingOrError: Models['CustomerBalance_type'] | number | Error =
          await crossPlatformFetch(
            `${input.context.urlUserService}/user/payment/balance`,
            { method: 'GET' },
            input.event.apiToken
          )

        if (
          typeof billingOrError === 'number' ||
          billingOrError instanceof Error
        ) {
          return Promise.reject(billingOrError)
        }
        const billing: Models['CustomerBalance_type'] = billingOrError

        const subscriptionsOrError:
          | Models['ZooProductSubscriptions_type']
          | number
          | Error = await crossPlatformFetch(
          `${input.context.urlUserService}/user/payment/subscriptions`,
          { method: 'GET' },
          input.event.apiToken
        )

        const orgOrError: Models['Org_type'] | number | Error =
          await crossPlatformFetch(
            `${input.context.urlUserService}/org`,
            { method: 'GET' },
            input.event.apiToken
          )

        let credits =
          Number(billing.monthly_api_credits_remaining) +
          Number(billing.stable_api_credits_remaining)
        let allowance = undefined

        // If user is part of an org, the endpoint will return data.
        if (typeof orgOrError !== 'number' && !(orgOrError instanceof Error)) {
          credits = Infinity
          // Otherwise they are on a Pro or Free subscription
        } else if (
          typeof subscriptionsOrError !== 'number' &&
          !(subscriptionsOrError instanceof Error)
        ) {
          const subscriptions: Models['ZooProductSubscriptions_type'] =
            subscriptionsOrError
          if (subscriptions.modeling_app.name === 'pro') {
            credits = Infinity
          } else {
            allowance = Number(
              subscriptions.modeling_app.monthly_pay_as_you_go_api_credits
            )
          }
        }
        // If nothing matches, we show a credit total.

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
