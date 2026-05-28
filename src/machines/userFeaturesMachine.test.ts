import type * as ClientErrorsModule from '@src/lib/clientErrors'
import {
  UserFeaturesActor,
  UserFeaturesState,
  UserFeaturesTransition,
  userFeaturesContextHas,
  userFeaturesMachine,
} from '@src/machines/userFeaturesMachine'
import { describe, expect, it, vi } from 'vitest'
import { createActor, fromPromise, waitFor } from 'xstate'

const mockState = vi.hoisted(() => ({
  reportClientError: vi.fn(),
}))

vi.mock('@src/lib/clientErrors', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientErrorsModule>()
  return {
    ...actual,
    reportClientError: mockState.reportClientError,
  }
})

type TestFetchUserFeaturesInput = {
  token: string
}

type TestFetchUserFeaturesResult = { featureIds: Set<string> } | Error

describe('userFeaturesMachine', () => {
  it('loads feature ids once for a token and answers membership from context', async () => {
    const fetchFeatures = vi.fn(async () => ({
      featureIds: new Set(['plugins', 'sketch_experimental_features']),
    }))
    const actor = createActor(
      userFeaturesMachine.provide({
        actors: {
          [UserFeaturesActor.Fetch]: fromPromise<
            TestFetchUserFeaturesResult,
            TestFetchUserFeaturesInput
          >(fetchFeatures),
        },
      })
    ).start()

    try {
      actor.send({ type: UserFeaturesTransition.Load, token: 'token-a' })

      await waitFor(actor, (state) => state.matches(UserFeaturesState.Ready))

      actor.send({ type: UserFeaturesTransition.Load, token: 'token-a' })

      const context = actor.getSnapshot().context
      expect(fetchFeatures).toHaveBeenCalledTimes(1)
      expect(context.fetchedForToken).toBe('token-a')
      expect(userFeaturesContextHas(context, 'plugins', false)).toBe(true)
      expect(userFeaturesContextHas(context, 'missing', false)).toBe(false)
      expect(userFeaturesContextHas(context, 'missing', true)).toBe(true)
    } finally {
      actor.stop()
    }
  })

  it('clears feature ids on clear', async () => {
    const actor = createActor(
      userFeaturesMachine.provide({
        actors: {
          [UserFeaturesActor.Fetch]: fromPromise<
            TestFetchUserFeaturesResult,
            TestFetchUserFeaturesInput
          >(async () => ({
            featureIds: new Set(['plugins']),
          })),
        },
      })
    ).start()

    try {
      actor.send({ type: UserFeaturesTransition.Load, token: 'token-a' })
      await waitFor(actor, (state) => state.matches(UserFeaturesState.Ready))

      actor.send({ type: UserFeaturesTransition.Clear })

      const snapshot = actor.getSnapshot()
      expect(snapshot.matches(UserFeaturesState.Idle)).toBe(true)
      expect(snapshot.context.featureIds.size).toBe(0)
      expect(snapshot.context.fetchedForToken).toBeUndefined()
    } finally {
      actor.stop()
    }
  })

  it('does not expose stale features when loading a new token fails', async () => {
    const actor = createActor(
      userFeaturesMachine.provide({
        actors: {
          [UserFeaturesActor.Fetch]: fromPromise<
            TestFetchUserFeaturesResult,
            TestFetchUserFeaturesInput
          >(async ({ input }) => {
            if (input.token === 'token-b') {
              return new Error('feature service unavailable')
            }

            return {
              featureIds: new Set(['plugins']),
            }
          }),
        },
      })
    ).start()

    try {
      actor.send({ type: UserFeaturesTransition.Load, token: 'token-a' })
      await waitFor(actor, (state) => state.matches(UserFeaturesState.Ready))
      expect(
        userFeaturesContextHas(actor.getSnapshot().context, 'plugins', false)
      ).toBe(true)

      actor.send({ type: UserFeaturesTransition.Load, token: 'token-b' })
      await waitFor(actor, (state) => state.matches(UserFeaturesState.Failed))

      const context = actor.getSnapshot().context
      expect(context.featureIds.size).toBe(0)
      expect(context.fetchedForToken).toBeUndefined()
      expect(userFeaturesContextHas(context, 'plugins', false)).toBe(false)
      expect(mockState.reportClientError).toHaveBeenCalledWith({
        code: 'user_features_fetch_error',
        message: 'feature service unavailable',
        error: expect.any(Error),
        dedupeKey:
          'UserFeaturesMachine:fetch-error:feature service unavailable',
        extra: expect.objectContaining({
          source: 'UserFeaturesMachine',
          eventType: expect.stringMatching(/^xstate\.done\.actor\./),
          featureCount: 0,
          hasFetchedForToken: false,
          hasLoadingToken: true,
        }),
      })
    } finally {
      actor.stop()
    }
  })
})
