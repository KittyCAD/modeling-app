import type { Feature } from '@kittycad/lib'
import type * as ClientErrorsModule from '@src/lib/clientErrors'
import {
  USER_FEATURES_POLL_INTERVAL_MS,
  USER_FEATURES_RETRY_INTERVAL_MS,
  USER_FEATURES_SETTLE_TIMEOUT_MS,
  UserFeaturesActor,
  type UserFeaturesSettleSnapshot,
  type UserFeaturesSettleSource,
  UserFeaturesState,
  UserFeaturesTransition,
  userFeaturesContextHas,
  userFeaturesMachine,
  userFeaturesSnapshotSettled,
  waitForUserFeaturesSettled,
} from '@src/machines/userFeaturesMachine'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

function snapshotIn(
  state: UserFeaturesState,
  fetchedAt?: Date
): UserFeaturesSettleSnapshot {
  return {
    matches: (candidate) => candidate === state,
    context: { fetchedAt },
  }
}

function createFakeSource(initial: UserFeaturesSettleSnapshot) {
  let snapshot = initial
  const listeners = new Set<(snapshot: UserFeaturesSettleSnapshot) => void>()
  const source: UserFeaturesSettleSource = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return { unsubscribe: () => listeners.delete(listener) }
    },
  }
  return {
    source,
    update: (next: UserFeaturesSettleSnapshot) => {
      snapshot = next
      for (const listener of listeners) {
        listener(next)
      }
    },
    listenerCount: () => listeners.size,
  }
}

const flushMicrotasks = () => Promise.resolve()

describe('userFeaturesSnapshotSettled', () => {
  it('treats Ready and Failed as settled', () => {
    expect(
      userFeaturesSnapshotSettled(snapshotIn(UserFeaturesState.Ready))
    ).toBe(true)
    expect(
      userFeaturesSnapshotSettled(snapshotIn(UserFeaturesState.Failed))
    ).toBe(true)
  })

  it('treats Idle and a first Loading as unsettled', () => {
    expect(
      userFeaturesSnapshotSettled(snapshotIn(UserFeaturesState.Idle))
    ).toBe(false)
    expect(
      userFeaturesSnapshotSettled(snapshotIn(UserFeaturesState.Loading))
    ).toBe(false)
  })

  it('treats a poll refresh (Loading after a previous load) as settled', () => {
    expect(
      userFeaturesSnapshotSettled(
        snapshotIn(UserFeaturesState.Loading, new Date())
      )
    ).toBe(true)
  })
})

describe('waitForUserFeaturesSettled', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves immediately without subscribing when already settled', async () => {
    const ready = createFakeSource(snapshotIn(UserFeaturesState.Ready))
    await waitForUserFeaturesSettled(ready.source)
    expect(ready.listenerCount()).toBe(0)

    const failed = createFakeSource(snapshotIn(UserFeaturesState.Failed))
    await waitForUserFeaturesSettled(failed.source)
    expect(failed.listenerCount()).toBe(0)
  })

  it('waits for an unsettled source, then resolves and unsubscribes', async () => {
    const fake = createFakeSource(snapshotIn(UserFeaturesState.Loading))
    const settled = vi.fn()
    void waitForUserFeaturesSettled(fake.source).then(settled)

    await flushMicrotasks()
    expect(settled).not.toHaveBeenCalled()
    expect(fake.listenerCount()).toBe(1)

    fake.update(snapshotIn(UserFeaturesState.Ready))
    await flushMicrotasks()
    expect(settled).toHaveBeenCalledTimes(1)
    expect(fake.listenerCount()).toBe(0)
  })

  it('ignores snapshots that are still unsettled', async () => {
    const fake = createFakeSource(snapshotIn(UserFeaturesState.Idle))
    const settled = vi.fn()
    void waitForUserFeaturesSettled(fake.source).then(settled)

    fake.update(snapshotIn(UserFeaturesState.Loading))
    await flushMicrotasks()
    expect(settled).not.toHaveBeenCalled()

    fake.update(snapshotIn(UserFeaturesState.Failed))
    await flushMicrotasks()
    expect(settled).toHaveBeenCalledTimes(1)
  })

  it('resolves and unsubscribes when aborted', async () => {
    const fake = createFakeSource(snapshotIn(UserFeaturesState.Idle))
    const controller = new AbortController()
    const settled = vi.fn()
    void waitForUserFeaturesSettled(
      fake.source,
      USER_FEATURES_SETTLE_TIMEOUT_MS,
      controller.signal
    ).then(settled)

    await flushMicrotasks()
    expect(fake.listenerCount()).toBe(1)
    expect(settled).not.toHaveBeenCalled()

    controller.abort()
    await flushMicrotasks()
    expect(fake.listenerCount()).toBe(0)
    expect(settled).toHaveBeenCalledTimes(1)
  })

  it('resolves at the timeout when the source never settles', async () => {
    vi.useFakeTimers()
    const fake = createFakeSource(snapshotIn(UserFeaturesState.Idle))
    const settled = vi.fn()
    void waitForUserFeaturesSettled(fake.source).then(settled)

    await vi.advanceTimersByTimeAsync(USER_FEATURES_SETTLE_TIMEOUT_MS - 1)
    expect(settled).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toHaveBeenCalledTimes(1)
    expect(fake.listenerCount()).toBe(0)
  })

  it('accepts a real machine actor and resolves at the timeout when idle', async () => {
    vi.useFakeTimers()
    const actor = createActor(userFeaturesMachine).start()
    const settled = vi.fn()
    void waitForUserFeaturesSettled(actor, 50).then(settled)

    await vi.advanceTimersByTimeAsync(49)
    expect(settled).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toHaveBeenCalledTimes(1)
    actor.stop()
  })
})
