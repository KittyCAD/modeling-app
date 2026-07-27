import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import {
  loadHomeProjects,
  webHomeRouteEnabled,
} from '@src/lib/routeLoaderUtils'
import { SystemIOMachineEvents } from '@src/machines/systemIO/events'
import {
  type UserFeaturesContext,
  UserFeaturesState,
  UserFeaturesTransition,
} from '@src/machines/userFeaturesMachine'
import { beforeEach, describe, expect, it, vi } from 'vitest'

function setWebRuntime() {
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: undefined,
  })
}

type FakeSnapshot<TContext> = {
  context: TContext
  matches: (state: string) => boolean
}

function createFakeSnapshot<TContext>(
  state: string,
  context: TContext
): FakeSnapshot<TContext> {
  return {
    context,
    matches: (candidate) => candidate === state,
  }
}

function createFakeActor<TSnapshot>(initialSnapshot: TSnapshot) {
  let snapshot = initialSnapshot
  const listeners = new Set<(nextSnapshot: TSnapshot) => void>()

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: (nextSnapshot: TSnapshot) => void) => {
      listeners.add(listener)
      return {
        unsubscribe: () => listeners.delete(listener),
      }
    },
    setSnapshot: (nextSnapshot: TSnapshot) => {
      snapshot = nextSnapshot
      for (const listener of listeners) {
        listener(nextSnapshot)
      }
    },
  }
}

function createAppWithWebHomeFeature(enabled: boolean) {
  const closeProject = vi.fn()
  const authActor = createFakeActor(
    createFakeSnapshot('loggedIn', { token: 'token' })
  )
  const userFeaturesActor = createFakeActor(
    createFakeSnapshot(UserFeaturesState.Ready, {
      featureIds: new Set(enabled ? [OPFS_CLOUD_FEATURE_FLAG] : []),
    } satisfies UserFeaturesContext)
  )
  const app = {
    auth: {
      actor: authActor,
    },
    userFeatures: {
      actor: userFeaturesActor,
      send: vi.fn(),
    },
    systemIOActor: {
      send: vi.fn(),
    },
    closeProject,
    settings: {
      actor: {
        send: vi.fn(),
      },
    },
  }

  return {
    app,
    authActor,
    closeProject,
    userFeaturesActor,
  }
}

describe('route loaders', () => {
  beforeEach(() => {
    setWebRuntime()
  })

  it('enables web Home when the OPFS cloud feature flag is present', async () => {
    const { app } = createAppWithWebHomeFeature(true)

    await expect(webHomeRouteEnabled(app)).resolves.toBe(true)
  })

  it('keeps web Home disabled when the feature flag is absent', async () => {
    const { app } = createAppWithWebHomeFeature(false)

    await expect(webHomeRouteEnabled(app)).resolves.toBe(false)
  })

  it('loads Home project state without touching the demo-project flow', () => {
    const { app, closeProject } = createAppWithWebHomeFeature(true)

    const result = loadHomeProjects(app)

    expect(result).toEqual({})
    expect(app.systemIOActor.send).toHaveBeenCalledWith({
      type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
    })
    expect(closeProject).toHaveBeenCalled()
    expect(app.settings.actor.send).toHaveBeenCalledWith({
      type: 'clear.project',
    })
  })

  it('waits for user features before deciding whether web Home is enabled', async () => {
    const { app, userFeaturesActor } = createAppWithWebHomeFeature(false)
    userFeaturesActor.setSnapshot(
      createFakeSnapshot(UserFeaturesState.Loading, {
        featureIds: new Set(),
      })
    )

    const enabledPromise = webHomeRouteEnabled(app)
    userFeaturesActor.setSnapshot(
      createFakeSnapshot(UserFeaturesState.Ready, {
        featureIds: new Set([OPFS_CLOUD_FEATURE_FLAG]),
      })
    )

    await expect(enabledPromise).resolves.toBe(true)
  })

  it('starts loading user features from auth when the feature actor is idle', async () => {
    const { app } = createAppWithWebHomeFeature(false)
    app.userFeatures.actor.setSnapshot(
      createFakeSnapshot(UserFeaturesState.Idle, {
        featureIds: new Set(),
      })
    )

    const enabledPromise = webHomeRouteEnabled(app)

    expect(app.userFeatures.send).toHaveBeenCalledWith({
      type: UserFeaturesTransition.Load,
      token: 'token',
    })

    app.userFeatures.actor.setSnapshot(
      createFakeSnapshot(UserFeaturesState.Ready, {
        featureIds: new Set([OPFS_CLOUD_FEATURE_FLAG]),
      })
    )

    await expect(enabledPromise).resolves.toBe(true)
  })
})
