import { BillingError, getBillingInfo } from '@kittycad/react-shared'
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

export interface BillingContext {
  credits: undefined | number
  allowance: undefined | number
  isOrg?: boolean
  hasSubscription?: boolean
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
          console.log(
            'pierre actor about to return early cause debouced',
            JSON.stringify(input.context)
          )
          return input.context
        }

        const client = createKCClient(input.event.apiToken)
        const billing = await getBillingInfo(client)
        if (BillingError.from(billing)) {
          console.log(
            'pierre actor about to reject with error',
            JSON.stringify(billing)
          )
          return Promise.reject(billing)
        }

        console.log(
          'pierre actor about to return',
          JSON.stringify({
            credits: billing.credits,
            allowance: billing.allowance,
            isOrg: billing.isOrg,
            hasSubscription: billing.hasSubscription,
            lastFetch: new Date(),
            error: undefined,
          })
        )
        return {
          credits: billing.credits,
          allowance: billing.allowance,
          isOrg: billing.isOrg,
          hasSubscription: billing.hasSubscription,
          lastFetch: new Date(),
          error: undefined,
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
            actions: assign(({ event }) => {
              console.log('pierre onDone event', JSON.stringify(event))
              return event.output
            }),
          },
        ],
        // If request failed for billing, go back into waiting state,
        // and signal to the user there's an issue regarding the service.
        onError: [
          {
            target: BillingState.Waiting,
            // Yep, this is hard to follow. XState, why!
            actions: assign({
              credits: undefined,
              allowance: undefined,
              isOrg: undefined,
              hasSubscription: undefined,
              lastFetch: new Date(),
              // TODO: we shouldn't need this cast here
              error: ({ event }) => {
                console.log('pierre onError event', JSON.stringify(event))
                return event.error as BillingError
              },
            }),
          },
        ],
      },
    },
  },
})

export type BillingActor = ActorRefFrom<typeof billingMachine>
