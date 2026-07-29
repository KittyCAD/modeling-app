import {
  BillingError,
  getBillingInfo,
  type IBillingInfo,
} from '@kittycad/ui-components'
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
  UsageStarted = 'usage-started',
  UsageEnded = 'usage-ended',
}

export interface BillingContext extends Partial<IBillingInfo> {
  error: undefined | BillingError
  urlUserService: () => string
  lastFetch: undefined | Date
  usageStartedAt: undefined | Date
  usageAccumulatedMs: number
  updateApiToken: undefined | string
  pendingUpdateApiToken: undefined | string
}

export type BillingMachineEvent =
  | { type: BillingTransition.Update; apiToken: string }
  | { type: BillingTransition.UsageStarted }
  | { type: BillingTransition.UsageEnded }

export const BILLING_CONTEXT_DEFAULTS: BillingContext = Object.freeze({
  balance: undefined,
  allowance: undefined,
  userPaymentBalance: undefined,
  payAsYouGoApiCreditPrice: undefined,
  error: undefined,
  isOrg: undefined,
  hasSubscription: undefined,
  urlUserService: () => '',
  lastFetch: undefined,
  usageStartedAt: undefined,
  usageAccumulatedMs: 0,
  updateApiToken: undefined,
  pendingUpdateApiToken: undefined,
})

function applyBillingUpdateOutput(
  context: BillingContext,
  output: BillingContext
): BillingContext {
  if (output.lastFetch === context.lastFetch) {
    return context
  }

  const lastFetch = output.lastFetch ?? new Date()
  const usageStartedAt =
    context.usageStartedAt === undefined
      ? undefined
      : new Date(
          Math.max(context.usageStartedAt.getTime(), lastFetch.getTime())
        )

  return {
    ...output,
    usageStartedAt,
    usageAccumulatedMs: 0,
    updateApiToken: context.updateApiToken,
    pendingUpdateApiToken: context.pendingUpdateApiToken,
  }
}

export const billingMachine = setup({
  types: {
    context: {} as BillingContext,
    input: {} as BillingContext,
    events: {} as BillingMachineEvent,
  },
  actors: {
    [BillingTransition.Update]: fromPromise(
      async ({
        input,
      }: {
        input: { context: BillingContext; apiToken: string }
      }) => {
        // Rate limit on the client side to 1 request per second.
        if (
          input.context.lastFetch &&
          Date.now() - input.context.lastFetch.getTime() < _TIME_1_SECOND
        ) {
          console.log(
            'BillingTransition.Update was skipped as it was recently fetched'
          )
          return input.context
        }

        if (!input.apiToken) {
          console.log(
            'BillingTransition.Update was skipped as the token is missing'
          )
          return input.context
        }

        const client = createKCClient(input.apiToken)
        const billing = await getBillingInfo(client)
        if (BillingError.from(billing)) {
          return Promise.reject(billing)
        }

        return {
          ...BILLING_CONTEXT_DEFAULTS,
          balance: billing.balance,
          allowance: billing.allowance,
          userPaymentBalance: billing.userPaymentBalance,
          payAsYouGoApiCreditPrice: billing.payAsYouGoApiCreditPrice,
          isOrg: billing.isOrg,
          hasSubscription: billing.hasSubscription,
          lastFetch: new Date(),
        }
      }
    ),
  },
}).createMachine({
  initial: BillingState.Waiting,
  context: (args) => args.input,
  on: {
    [BillingTransition.UsageStarted]: {
      actions: assign(({ context }) => {
        if (context.usageStartedAt !== undefined) {
          return {}
        }

        return {
          usageStartedAt: new Date(),
        }
      }),
    },
    [BillingTransition.UsageEnded]: {
      actions: assign(({ context }) => {
        if (context.usageStartedAt === undefined) {
          return {}
        }

        return {
          usageStartedAt: undefined,
          usageAccumulatedMs:
            context.usageAccumulatedMs +
            Math.max(0, Date.now() - context.usageStartedAt.getTime()),
        }
      }),
    },
  },
  states: {
    [BillingState.Waiting]: {
      on: {
        [BillingTransition.Update]: {
          target: BillingState.Updating,
          actions: assign({
            updateApiToken: ({ event }) => event.apiToken,
          }),
        },
      },
    },
    [BillingState.Updating]: {
      on: {
        [BillingTransition.Update]: {
          actions: assign({
            pendingUpdateApiToken: ({ event }) => event.apiToken,
          }),
        },
      },
      invoke: {
        src: BillingTransition.Update,
        input: (args: { context: BillingContext }) => ({
          context: args.context,
          apiToken: args.context.updateApiToken ?? '',
        }),
        onDone: [
          {
            guard: ({ context }) => context.pendingUpdateApiToken !== undefined,
            target: BillingState.Updating,
            actions: assign(({ context, event }) => {
              return {
                ...applyBillingUpdateOutput(context, event.output),
                updateApiToken: context.pendingUpdateApiToken,
                pendingUpdateApiToken: undefined,
              }
            }),
          },
          {
            target: BillingState.Waiting,
            actions: assign(({ context, event }) => {
              return {
                ...applyBillingUpdateOutput(context, event.output),
                updateApiToken: undefined,
                pendingUpdateApiToken: undefined,
              }
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
