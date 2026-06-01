import type { App } from '@src/lib/app'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import { baseLoader, homeLoader } from '@src/lib/routeLoaders'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { UserFeaturesState } from '@src/machines/userFeaturesMachine'
import type { LoaderFunctionArgs } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

function setWebRuntime() {
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: undefined,
  })
}

type FakeSnapshot = {
  context: {
    featureIds?: Set<typeof OPFS_CLOUD_FEATURE_FLAG>
    token?: string
  }
  matches: (state: string) => boolean
}

function createFakeSnapshot(
  state: string,
  context: FakeSnapshot['context'] = {}
): FakeSnapshot {
  return {
    context,
    matches: (candidate) => candidate === state,
  }
}

function createFakeActor(initialSnapshot: FakeSnapshot) {
  let snapshot = initialSnapshot
  const listeners = new Set<(nextSnapshot: FakeSnapshot) => void>()

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: (nextSnapshot: FakeSnapshot) => void) => {
      listeners.add(listener)
      return {
        unsubscribe: () => listeners.delete(listener),
      }
    },
    setSnapshot: (nextSnapshot: FakeSnapshot) => {
      snapshot = nextSnapshot
      for (const listener of listeners) {
        listener(nextSnapshot)
      }
    },
  }
}

function createAppWithWebHomeFeature(enabled: boolean) {
  const authActor = createFakeActor(
    createFakeSnapshot('loggedIn', { token: 'token' })
  )
  const userFeaturesActor = createFakeActor(
    createFakeSnapshot(UserFeaturesState.Ready, {
      featureIds: new Set(enabled ? [OPFS_CLOUD_FEATURE_FLAG] : []),
    })
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
    closeProject: vi.fn(),
    settings: {
      actor: {
        send: vi.fn(),
      },
    },
  } as unknown as App

  return {
    app,
    authActor,
    userFeaturesActor,
  }
}

function loaderArgs(url: string): LoaderFunctionArgs {
  return {
    request: new Request(url),
    params: {},
    context: undefined,
    unstable_pattern: '',
  }
}

describe('route loaders', () => {
  beforeEach(() => {
    setWebRuntime()
  })

  it('redirects flagged web root requests to Home', async () => {
    const { app } = createAppWithWebHomeFeature(true)
    const response = await baseLoader({
      app,
    })(loaderArgs('http://zoo.local/?debug=true'))

    expect(response).toBeInstanceOf(Response)
    expect((response as Response).headers.get('Location')).toBe(
      '/home?debug=true'
    )
  })

  it('keeps unflagged web Home requests on the single-project route', async () => {
    const { app } = createAppWithWebHomeFeature(false)
    const response = await homeLoader({
      app,
    })(loaderArgs('http://zoo.local/home'))

    expect(response).toBeInstanceOf(Response)
    expect((response as Response).headers.get('Location')).toBe('/')
  })

  it('loads Home on web when the feature flag is present', async () => {
    const { app } = createAppWithWebHomeFeature(true)

    const result = await homeLoader({ app })(
      loaderArgs('http://zoo.local/home')
    )

    expect(result).toEqual({})
    expect(app.systemIOActor.send).toHaveBeenCalledWith({
      type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
    })
    expect(app.closeProject).toHaveBeenCalled()
    expect(app.settings.actor.send).toHaveBeenCalledWith({
      type: 'clear.project',
    })
  })

  it('waits for user features before falling back to the demo project flow', async () => {
    const { app, userFeaturesActor } = createAppWithWebHomeFeature(false)
    userFeaturesActor.setSnapshot(
      createFakeSnapshot(UserFeaturesState.Loading, {
        featureIds: new Set(),
      })
    )

    const responsePromise = baseLoader({ app })(loaderArgs('http://zoo.local/'))
    userFeaturesActor.setSnapshot(
      createFakeSnapshot(UserFeaturesState.Ready, {
        featureIds: new Set([OPFS_CLOUD_FEATURE_FLAG]),
      })
    )

    const response = await responsePromise
    expect(response).toBeInstanceOf(Response)
    expect((response as Response).headers.get('Location')).toBe('/home')
  })
})
