import { users } from '@kittycad/lib'
import { createKCClient, kcCall } from '@src/lib/kcClient'
import { isArray } from '@src/lib/utils'
import type { ActorRefFrom } from 'xstate'
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

type UserFeaturesData = Extract<
  Awaited<ReturnType<typeof users.user_features_get>>,
  { features: unknown }
>

type FetchUserFeaturesInput = {
  token: string
}

type FetchUserFeaturesOutput = {
  featureIds: Set<string>
}

export interface UserFeaturesContext {
  featureIds: Set<string>
  fetchedForToken?: string
  fetchedAt?: Date
  loadingToken?: string
  error?: unknown
}

export type UserFeaturesEvent =
  | { type: UserFeaturesTransition.Load; token: string }
  | { type: UserFeaturesTransition.Refresh; token?: string }
  | { type: UserFeaturesTransition.Clear }

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
  const features = isArray(data.features) ? data.features : []
  return new Set(
    features.flatMap((feature) =>
      feature &&
      typeof feature === 'object' &&
      'id' in feature &&
      typeof feature.id === 'string'
        ? [feature.id]
        : []
    )
  )
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
      FetchUserFeaturesOutput,
      FetchUserFeaturesInput
    >(async ({ input }) => {
      const client = createKCClient(input.token)
      const result = await kcCall(() => users.user_features_get({ client }))
      if (result instanceof Error) {
        throw result
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
  },
  actions: {
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

      const output = event.output as FetchUserFeaturesOutput
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
      error: 'error' in event ? event.error : undefined,
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
        onDone: {
          target: UserFeaturesState.Ready,
          actions: 'storeFeatures',
        },
        onError: {
          target: UserFeaturesState.Failed,
          actions: 'storeError',
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
