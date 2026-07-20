import type { Feature } from '@kittycad/lib'
import type * as ClientErrorsModule from '@src/lib/clientErrors'
import {
  USER_FEATURES_POLL_INTERVAL_MS,
  USER_FEATURES_RETRY_INTERVAL_MS,
  UserFeaturesActor,
  UserFeaturesState,
  UserFeaturesTransition,
  userFeaturesContextHas,
  userFeaturesMachine,
} from '@src/machines/userFeaturesMachine'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

type TestFetchUserFeaturesResult = { featureIds: Set<Feature> } | Error

describe('userFeaturesMachine', () => {
  beforeEach(() => {
    mockState.reportClientError.mockClear()
  })

  it('loads feature ids once for a token and answers membership from context', async () => {
    const fetchFeatures = vi.fn(async () => ({
      featureIds: new Set<Feature>(['sketch_experimental_features']),
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
      expect(context.token).toBe('token-a')
      expect(
        userFeaturesContextHas(context, 'sketch_experimental_features', false)
      ).toBe(true)
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
            featureIds: new Set<Feature>(['sketch_experimental_features']),
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
      expect(snapshot.context.token).toBeUndefined()
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
              featureIds: new Set<Feature>(['sketch_experimental_features']),
            }
          }),
        },
      })
    ).start()

    try {
      actor.send({ type: UserFeaturesTransition.Load, token: 'token-a' })
      await waitFor(actor, (state) => state.matches(UserFeaturesState.Ready))
      expect(
        userFeaturesContextHas(
          actor.getSnapshot().context,
          'sketch_experimental_features',
          false
        )
      ).toBe(true)

      actor.send({ type: UserFeaturesTransition.Load, token: 'token-b' })
      await waitFor(actor, (state) => state.matches(UserFeaturesState.Failed))

      const context = actor.getSnapshot().context
      expect(context.featureIds.size).toBe(0)
      expect(context.token).toBe('token-b')
      expect(
        userFeaturesContextHas(context, 'sketch_experimental_features', false)
      ).toBe(false)
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
          hasToken: true,
        }),
      })
    } finally {
      actor.stop()
    }
  })

  it('polls feature ids after a successful load', async () => {
    vi.useFakeTimers()
    const fetchFeatures = vi
      .fn()
      .mockResolvedValueOnce({ featureIds: new Set<Feature>() })
      .mockResolvedValueOnce({
        featureIds: new Set<Feature>(['sketch_experimental_features']),
      })
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

      expect(fetchFeatures).toHaveBeenCalledTimes(1)
      expect(
        userFeaturesContextHas(
          actor.getSnapshot().context,
          'sketch_experimental_features',
          false
        )
      ).toBe(false)

      await vi.advanceTimersByTimeAsync(USER_FEATURES_POLL_INTERVAL_MS)
      await waitFor(
        actor,
        (state) =>
          state.matches(UserFeaturesState.Ready) &&
          fetchFeatures.mock.calls.length === 2
      )

      expect(fetchFeatures).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          input: { token: 'token-a' },
        })
      )
      expect(
        userFeaturesContextHas(
          actor.getSnapshot().context,
          'sketch_experimental_features',
          false
        )
      ).toBe(true)
    } finally {
      actor.stop()
      vi.useRealTimers()
    }
  })

  it('retries a failed initial load with the current token', async () => {
    vi.useFakeTimers()
    const fetchFeatures = vi
      .fn()
      .mockResolvedValueOnce(new Error('feature service unavailable'))
      .mockResolvedValueOnce({
        featureIds: new Set<Feature>(['sketch_experimental_features']),
      })
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
      await waitFor(actor, (state) => state.matches(UserFeaturesState.Failed))

      expect(fetchFeatures).toHaveBeenCalledTimes(1)
      expect(actor.getSnapshot().context.token).toBe('token-a')

      await vi.advanceTimersByTimeAsync(USER_FEATURES_RETRY_INTERVAL_MS)
      await waitFor(
        actor,
        (state) =>
          state.matches(UserFeaturesState.Ready) &&
          fetchFeatures.mock.calls.length === 2
      )

      expect(fetchFeatures).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          input: { token: 'token-a' },
        })
      )
      expect(
        userFeaturesContextHas(
          actor.getSnapshot().context,
          'sketch_experimental_features',
          false
        )
      ).toBe(true)
    } finally {
      actor.stop()
      vi.useRealTimers()
    }
  })
})
