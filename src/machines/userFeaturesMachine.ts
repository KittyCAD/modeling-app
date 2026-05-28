import { users } from '@kittycad/lib'
import { ClientErrorCode, reportClientError } from '@src/lib/clientErrors'
import { createKCClient, kcCall } from '@src/lib/kcClient'
import { isErr } from '@src/lib/trap'
import { xstateEventError } from '@src/machines/utils'
import type { ActorRefFrom, DoneActorEvent, ErrorActorEvent } from 'xstate'
import { assign, fromPromise, setup } from 'xstate'

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

type UserFeaturesData = Awaited<ReturnType<typeof users.user_features_get>>

type FetchUserFeaturesInput = {
  token: string
}

type FetchUserFeaturesOutput = {
  featureIds: Set<string>
}
type FetchUserFeaturesResult = FetchUserFeaturesOutput | Error
type FetchUserFeaturesDoneEvent = DoneActorEvent<FetchUserFeaturesResult>
type FetchUserFeaturesErrorEvent = ErrorActorEvent<Error>

export interface UserFeaturesContext {
  featureIds: Set<string>
  fetchedForToken?: string
  fetchedAt?: Date
  loadingToken?: string
  error?: Error
}

export type UserFeaturesEvent =
  | { type: UserFeaturesTransition.Load; token: string }
  | { type: UserFeaturesTransition.Refresh; token?: string }
  | { type: UserFeaturesTransition.Clear }
  | FetchUserFeaturesDoneEvent
  | FetchUserFeaturesErrorEvent

export type UserFeaturesService = {
  has: (featureFlagId: string, defaultValue: boolean) => boolean
}

function createDefaultContext(): UserFeaturesContext {
  return {
    featureIds: new Set<string>(),
    fetchedForToken: undefined,
    fetchedAt: undefined,
    loadingToken: undefined,
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
    return event.token ?? context.fetchedForToken ?? context.loadingToken
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

function featureIdsFromResponse(data: UserFeaturesData): Set<string> {
  return new Set(data.features.map(({ id }) => id))
}

function userFeaturesErrorContext(context: UserFeaturesContext) {
  return {
    featureCount: context.featureIds.size,
    hasFetchedForToken: Boolean(context.fetchedForToken),
    hasLoadingToken: Boolean(context.loadingToken),
    fetchedAt: context.fetchedAt?.toISOString(),
  }
}

export function userFeaturesContextHas(
  context: UserFeaturesContext,
  featureFlagId: string,
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
      return !!token && context.fetchedForToken === token
    },
    alreadyLoadingForToken: ({ context, event }) => {
      const token = getEventToken(context, event)
      return !!token && context.loadingToken === token
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
        error: undefined,
        loadingToken: token,
        ...(context.fetchedForToken === token
          ? {}
          : {
              featureIds: new Set<string>(),
              fetchedForToken: undefined,
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
        fetchedForToken: context.loadingToken,
        fetchedAt: new Date(),
        loadingToken: undefined,
        error: undefined,
      }
    }),
    storeError: assign(({ event }) => ({
      loadingToken: undefined,
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
          token: context.loadingToken ?? '',
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
    },
    [UserFeaturesState.Failed]: {
      on: {
        [UserFeaturesTransition.Load]: [
          {
            guard: 'alreadyLoadingForToken',
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
    },
  },
})

export type UserFeaturesActorRef = ActorRefFrom<typeof userFeaturesMachine>
