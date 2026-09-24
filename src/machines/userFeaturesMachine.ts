import { type Feature, type UserFeatureList, users } from '@kittycad/lib'
import { ClientErrorCode, reportClientError } from '@src/lib/clientErrors'
import { createKCClient, kcCall } from '@src/lib/kcClient'
import { isErr } from '@src/lib/trap'
import { xstateEventError } from '@src/machines/utils'
import type { ActorRefFrom, DoneActorEvent, ErrorActorEvent } from 'xstate'
import { assign, fromPromise, raise, setup } from 'xstate'

export const USER_FEATURES_POLL_INTERVAL_MS = 5 * 60 * 1000
export const USER_FEATURES_RETRY_INTERVAL_MS = 60 * 1000

export enum UserFeaturesState {
  Idle = 'idle',
  Loading = 'loading',
  Ready = 'ready',
  Failed = 'failed',
}

export enum UserFeaturesTransition {
  Load = 'Load',
  Refresh = 'Refresh',
  Clear = 'Clear',
}

export enum UserFeaturesActor {
  Fetch = 'Fetch',
}

type FetchUserFeaturesInput = {
  token: string
}

type FetchUserFeaturesOutput = {
  featureIds: Set<Feature>
}
type FetchUserFeaturesResult = FetchUserFeaturesOutput | Error
type FetchUserFeaturesDoneEvent = DoneActorEvent<FetchUserFeaturesResult>
type FetchUserFeaturesErrorEvent = ErrorActorEvent<Error>

export interface UserFeaturesContext {
  featureIds: Set<Feature>
  token?: string
  fetchedAt?: Date
  error?: Error
}

export type UserFeaturesEvent =
  | { type: UserFeaturesTransition.Load; token: string }
  | { type: UserFeaturesTransition.Refresh }
  | { type: UserFeaturesTransition.Clear }
  | FetchUserFeaturesDoneEvent
  | FetchUserFeaturesErrorEvent

export type UserFeaturesService = {
  has: (featureFlagId: Feature, defaultValue: boolean) => boolean
}

/**
 * How long callers gated on user features wait before proceeding anyway.
 * A failed fetch settles immediately; this only bounds a hung request or a
 * machine that never received a Load (e.g. logged out).
 */
export const USER_FEATURES_SETTLE_TIMEOUT_MS = 10_000

/**
 * The narrow snapshot/actor surface needed to await feature settlement, so
 * consumers and test doubles don't need a full xstate actor.
 */
export interface UserFeaturesSettleSnapshot {
  matches: (state: UserFeaturesState) => boolean
  context: { fetchedAt?: Date }
}

export interface UserFeaturesSettleSource {
  getSnapshot: () => UserFeaturesSettleSnapshot
  subscribe: (listener: (snapshot: UserFeaturesSettleSnapshot) => void) => {
    unsubscribe: () => void
  }
}

export type UserFeaturesSettleService = {
  actor: UserFeaturesSettleSource
}

/**
 * Whether the user-features fetch has settled: reached Ready or Failed, or
 * loaded at least once for this token. A poll refresh re-enters Loading but
 * keeps `fetchedAt` from the previous load, so it still counts as settled.
 */
export function userFeaturesSnapshotSettled(
  snapshot: UserFeaturesSettleSnapshot
): boolean {
  return (
    snapshot.matches(UserFeaturesState.Ready) ||
    snapshot.matches(UserFeaturesState.Failed) ||
    snapshot.context.fetchedAt !== undefined
  )
}

/**
 * Resolves without rejecting when one condition is met:
 *
 * - The user-features fetch settles (see [userFeaturesSnapshotSettled]).
 * - `timeoutMs` elapses.
 * - The optional abort signal is aborted.
 */
export function waitForUserFeaturesSettled(
  source: UserFeaturesSettleSource,
  timeoutMs: number = USER_FEATURES_SETTLE_TIMEOUT_MS,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted || userFeaturesSnapshotSettled(source.getSnapshot())) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    let done = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let subscription: { unsubscribe: () => void } | undefined
    const finish = () => {
      if (done) {
        return
      }
      done = true
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
      signal?.removeEventListener('abort', finish)
      subscription?.unsubscribe()
      resolve()
    }

    signal?.addEventListener('abort', finish, { once: true })
    if (signal?.aborted) {
      finish()
      return
    }

    subscription = source.subscribe((snapshot) => {
      if (userFeaturesSnapshotSettled(snapshot)) {
        finish()
      }
    })
    if (done) {
      // The listener fired synchronously before `subscription` was assigned.
      subscription.unsubscribe()
      return
    }
    if (userFeaturesSnapshotSettled(source.getSnapshot())) {
      // Settled between the initial check and subscribing.
      finish()
      return
    }
    timeoutId = setTimeout(finish, timeoutMs)
  })
}

function createDefaultContext(): UserFeaturesContext {
  return {
    featureIds: new Set<Feature>(),
    token: undefined,
    fetchedAt: undefined,
    error: undefined,
  }
}

function getEventToken(
  context: UserFeaturesContext,
  event: UserFeaturesEvent
): string | undefined {
  if (event.type === UserFeaturesTransition.Load) {
    return event.token
  }

  if (event.type === UserFeaturesTransition.Refresh) {
    return context.token
  }

  return undefined
}

function hasEventToken(
  context: UserFeaturesContext,
  event: UserFeaturesEvent
): boolean {
  const token = getEventToken(context, event)
  return typeof token === 'string' && token.length > 0
}

function featureIdsFromResponse(data: UserFeatureList): Set<Feature> {
  return new Set(data.features.map(({ id }) => id))
}

function userFeaturesErrorContext(context: UserFeaturesContext) {
  return {
    featureCount: context.featureIds.size,
    hasToken: Boolean(context.token),
    fetchedAt: context.fetchedAt?.toISOString(),
  }
}

export function userFeaturesContextHas(
  context: UserFeaturesContext,
  featureFlagId: Feature,
  defaultValue: boolean
): boolean {
  return context.featureIds.has(featureFlagId) ? true : defaultValue
}

export const userFeaturesMachine = setup({
  types: {
    context: {} as UserFeaturesContext,
    events: {} as UserFeaturesEvent,
  },
  actors: {
    [UserFeaturesActor.Fetch]: fromPromise<
      FetchUserFeaturesResult,
      FetchUserFeaturesInput
    >(async ({ input }) => {
      const client = createKCClient(input.token)
      const result = await kcCall(() => users.user_features_get({ client }))
      if (isErr(result)) {
        return result
      }

      return {
        featureIds: featureIdsFromResponse(result),
      }
    }),
  },
  guards: {
    hasToken: ({ context, event }) => hasEventToken(context, event),
    alreadyLoadedForToken: ({ context, event }) => {
      const token = getEventToken(context, event)
      return !!token && context.token === token
    },
    alreadyLoadingForToken: ({ context, event }) => {
      const token = getEventToken(context, event)
      return !!token && context.token === token
    },
    fetchReturnedError: ({ event }) => 'output' in event && isErr(event.output),
  },
  actions: {
    reportFetchError: ({ context, event }) => {
      const error = xstateEventError(event)
      if (!isErr(error)) return

      void reportClientError({
        code: ClientErrorCode.UserFeaturesFetchError,
        message: error.message,
        error,
        dedupeKey: `UserFeaturesMachine:fetch-error:${error.message}`,
        extra: {
          source: 'UserFeaturesMachine',
          eventType: event.type,
          ...userFeaturesErrorContext(context),
        },
      })
    },
    startLoading: assign(({ context, event }) => {
      const token = getEventToken(context, event)
      if (!token) {
        return {}
      }

      return {
        token,
        error: undefined,
        ...(context.token === token
          ? {}
          : {
              featureIds: new Set<Feature>(),
              fetchedAt: undefined,
            }),
      }
    }),
    clear: assign(() => createDefaultContext()),
    storeFeatures: assign(({ context, event }) => {
      if (!('output' in event)) {
        return {}
      }

      const output = event.output
      if (isErr(output)) {
        return {}
      }

      return {
        featureIds: output.featureIds,
        fetchedAt: new Date(),
        error: undefined,
      }
    }),
    storeError: assign(({ event }) => ({
      error:
        'output' in event && isErr(event.output)
          ? event.output
          : 'error' in event
            ? event.error
            : undefined,
    })),
  },
}).createMachine({
  id: 'userFeatures',
  initial: UserFeaturesState.Idle,
  context: createDefaultContext,
  on: {
    [UserFeaturesTransition.Clear]: {
      target: `.${UserFeaturesState.Idle}`,
      actions: 'clear',
    },
  },
  states: {
    [UserFeaturesState.Idle]: {
      on: {
        [UserFeaturesTransition.Load]: {
          guard: 'hasToken',
          target: UserFeaturesState.Loading,
          actions: 'startLoading',
        },
      },
    },
    [UserFeaturesState.Loading]: {
      invoke: {
        src: UserFeaturesActor.Fetch,
        input: ({ context }) => ({
          token: context.token ?? '',
        }),
        onDone: [
          {
            guard: 'fetchReturnedError',
            target: UserFeaturesState.Failed,
            actions: ['reportFetchError', 'storeError'],
          },
          {
            target: UserFeaturesState.Ready,
            actions: 'storeFeatures',
          },
        ],
        onError: {
          target: UserFeaturesState.Failed,
          actions: ['reportFetchError', 'storeError'],
        },
      },
      on: {
        [UserFeaturesTransition.Load]: [
          {
            guard: 'alreadyLoadingForToken',
          },
          {
            guard: 'hasToken',
            target: UserFeaturesState.Loading,
            reenter: true,
            actions: 'startLoading',
          },
        ],
      },
    },
    [UserFeaturesState.Ready]: {
      on: {
        [UserFeaturesTransition.Load]: [
          {
            guard: 'alreadyLoadedForToken',
          },
          {
            guard: 'hasToken',
            target: UserFeaturesState.Loading,
            actions: 'startLoading',
          },
        ],
        [UserFeaturesTransition.Refresh]: {
          guard: 'hasToken',
          target: UserFeaturesState.Loading,
          actions: 'startLoading',
        },
      },
      after: {
        [USER_FEATURES_POLL_INTERVAL_MS]: {
          actions: raise({ type: UserFeaturesTransition.Refresh }),
        },
      },
    },
    [UserFeaturesState.Failed]: {
      on: {
        [UserFeaturesTransition.Load]: {
          guard: 'hasToken',
          target: UserFeaturesState.Loading,
          actions: 'startLoading',
        },
        [UserFeaturesTransition.Refresh]: {
          guard: 'hasToken',
          target: UserFeaturesState.Loading,
          actions: 'startLoading',
        },
      },
      after: {
        [USER_FEATURES_RETRY_INTERVAL_MS]: {
          actions: raise({ type: UserFeaturesTransition.Refresh }),
        },
      },
    },
  },
})

export type UserFeaturesActorRef = ActorRefFrom<typeof userFeaturesMachine>
