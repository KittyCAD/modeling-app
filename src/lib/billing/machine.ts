import {
  BillingError,
  EBillingError,
  getBillingInfo,
  type IBillingInfo,
} from '@kittycad/ui-components'
import { BILLING_ESTIMATE_DURATION_MS } from '@src/lib/billing/estimate'
import { createKCClient } from '@src/lib/kcClient'
import type { ActorRefFrom } from 'xstate'
import { assign, fromPromise, setup } from 'xstate'

const _TIME_1_SECOND = 1000
const BILLING_REQUEST_TIMEOUT_MS = 30_000

export enum BillingState {
  Throttling = 'throttling',
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
  usageEstimateExpiresAt: undefined | Date
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
  usageEstimateExpiresAt: undefined,
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
    // Only a successful refresh can renew the estimate for a running prompt.
    usageEstimateExpiresAt:
      context.usageStartedAt === undefined
        ? undefined
        : new Date(lastFetch.getTime() + BILLING_ESTIMATE_DURATION_MS),
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
  delays: {
    billingThrottle: ({ context }) =>
      context.lastFetch
        ? Math.max(
            0,
            _TIME_1_SECOND - (Date.now() - context.lastFetch.getTime())
          )
        : 0,
  },
  actors: {
    [BillingTransition.Update]: fromPromise(
      async ({
        input,
        signal,
      }: {
        input: { context: BillingContext; apiToken: string }
        signal: AbortSignal
      }) => {
        if (!input.apiToken) {
          console.log(
            'BillingTransition.Update was skipped as the token is missing'
          )
          return input.context
        }

        const client = createKCClient(input.apiToken)
        const fetchWithAuth = client.fetch ?? globalThis.fetch
        client.fetch = (resource, init) =>
          fetchWithAuth(resource, { ...init, signal })
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
          // Keep the deadline across interruptions until billing is refreshed.
          usageEstimateExpiresAt:
            context.usageEstimateExpiresAt ??
            new Date(
              (context.lastFetch?.getTime() ?? Date.now()) +
                BILLING_ESTIMATE_DURATION_MS
            ),
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
            context.usageEstimateExpiresAt !== undefined &&
            Date.now() >= context.usageEstimateExpiresAt.getTime()
              ? 0
              : context.usageAccumulatedMs +
                Math.max(0, Date.now() - context.usageStartedAt.getTime()),
        }
      }),
    },
  },
  states: {
    [BillingState.Waiting]: {
      always: {
        guard: ({ context }) => context.pendingUpdateApiToken !== undefined,
        target: BillingState.Throttling,
        actions: assign({
          updateApiToken: ({ context }) => context.pendingUpdateApiToken,
          pendingUpdateApiToken: undefined,
        }),
      },
      on: {
        [BillingTransition.Update]: {
          target: BillingState.Throttling,
          actions: assign({
            updateApiToken: ({ event }) => event.apiToken,
          }),
        },
      },
    },
    [BillingState.Throttling]: {
      after: {
        billingThrottle: BillingState.Updating,
      },
      on: {
        [BillingTransition.Update]: {
          actions: assign({
            updateApiToken: ({ event }) => event.apiToken,
          }),
        },
      },
    },
    [BillingState.Updating]: {
      after: {
        [BILLING_REQUEST_TIMEOUT_MS]: {
          target: BillingState.Waiting,
          actions: assign({
            updateApiToken: undefined,
            error: () =>
              new BillingError({ type: EBillingError.CatastrophicRequest }),
          }),
        },
      },
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
        onDone: {
          target: BillingState.Waiting,
          actions: assign(({ context, event }) => ({
            ...applyBillingUpdateOutput(context, event.output),
            updateApiToken: undefined,
          })),
        },
        // Keep the last successful balance and its expiry when a refresh fails.
        onError: [
          {
            target: BillingState.Waiting,
            // Yep, this is hard to follow. XState, why!
            actions: assign({
              updateApiToken: undefined,
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
