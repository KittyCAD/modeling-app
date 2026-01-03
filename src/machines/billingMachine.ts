import { BillingError, type IBillingInfo, getBillingInfo } from '@kittycad/react-shared'
import { createKCClient } from '@src/lib/kcClient'
import type { ActorRefFrom } from 'xstate'
import { assign, fromPromise, setup } from 'xstate'

const _TIME_1_SECOND = 1000

export enum BillingState {
  Updating = 'updating',
  Waiting = 'waiting',
}

export enum BillingTransition {
  Update = 'update',
  Wait = 'wait',
}

export interface BillingContext extends Partial<IBillingInfo> {
  error: undefined | BillingError
  urlUserService: () => string
  lastFetch: undefined | Date
}

export interface BillingUpdateEvent {
  type: BillingTransition.Update
  apiToken: string
}

export const BILLING_CONTEXT_DEFAULTS: BillingContext = Object.freeze({
  credits: undefined,
  allowance: undefined,
  paymentMethods: [],
  userPaymentBalance: undefined,
  error: undefined,
  isOrg: undefined,
  hasSubscription: undefined,
  urlUserService: () => '',
  lastFetch: undefined,
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
        // Rate limit on the client side to 1 request per second.
        if (
          input.context.lastFetch &&
          Date.now() - input.context.lastFetch.getTime() < _TIME_1_SECOND
        ) {
          return input.context
        }

        if (!input.event.apiToken) {
          console.log(
            'BillingTransition.Update was skipped as the token is missing'
          )
          return input.context
        }

        const client = createKCClient(input.event.apiToken)
        const billing = await getBillingInfo(client)
        if (BillingError.from(billing)) {
          return Promise.reject(billing)
        }

        return {
          ...BILLING_CONTEXT_DEFAULTS,
          credits: billing.credits,
          allowance: billing.allowance,
          paymentMethods: billing.paymentMethods,
          userPaymentBalance: billing.userPaymentBalance,
          isOrg: billing.isOrg,
          hasSubscription: billing.hasSubscription,
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
            actions: assign({
              // Clear out the rest of the fields here
              ...BILLING_CONTEXT_DEFAULTS,
              // TODO: we shouldn't need this cast here
              error: ({ event }) => event.error as BillingError,
            }),
          },
        ],
      },
    },
  },
})

export type BillingActor = ActorRefFrom<typeof billingMachine>
