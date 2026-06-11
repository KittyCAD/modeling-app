import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import { SystemIOMachineEvents } from '@src/machines/systemIO/events'
import {
  UserFeaturesState,
  UserFeaturesTransition,
  userFeaturesContextHas,
} from '@src/machines/userFeaturesMachine'
import {
  type SubscribableActor,
  waitForActorSnapshot,
} from '@src/machines/utils'

export const WEB_HOME_FEATURE_GATE_TIMEOUT_MS = 5000

type WebHomeApp = {
  auth: {
    actor: SubscribableActor<{
      context: {
        token?: string
      }
      matches(state: string): boolean
    }>
  }
  userFeatures: {
    actor: SubscribableActor<{
      context: Parameters<typeof userFeaturesContextHas>[0]
      matches(state: string): boolean
    }>
    send: (event: { type: UserFeaturesTransition.Load; token: string }) => void
  }
}

type HomeLoaderApp = {
  systemIOActor: {
    send: (event: {
      type: SystemIOMachineEvents.readFoldersFromProjectDirectory
    }) => void
  }
}

async function waitForWebHomeFeatureGate(app: WebHomeApp) {
  if (app.auth.actor.getSnapshot().matches('checkIfLoggedIn')) {
    const authSettled = await waitForActorSnapshot(
      app.auth.actor,
      (snapshot) => !snapshot.matches('checkIfLoggedIn'),
      WEB_HOME_FEATURE_GATE_TIMEOUT_MS
    )
    if (!authSettled) {
      return
    }
  }

  const authSnapshot = app.auth.actor.getSnapshot()
  if (!authSnapshot.matches('loggedIn')) {
    return
  }

  if (app.userFeatures.actor.getSnapshot().matches(UserFeaturesState.Idle)) {
    app.userFeatures.send({
      type: UserFeaturesTransition.Load,
      token: authSnapshot.context.token ?? '',
    })
  }

  if (
    app.userFeatures.actor.getSnapshot().matches(UserFeaturesState.Idle) ||
    app.userFeatures.actor.getSnapshot().matches(UserFeaturesState.Loading)
  ) {
    const featuresSettled = await waitForActorSnapshot(
      app.userFeatures.actor,
      (snapshot) =>
        snapshot.matches(UserFeaturesState.Ready) ||
        snapshot.matches(UserFeaturesState.Failed),
      WEB_HOME_FEATURE_GATE_TIMEOUT_MS
    )
    if (!featuresSettled) {
      return
    }
  }
}

export async function webHomeRouteEnabled(app: WebHomeApp) {
  await waitForWebHomeFeatureGate(app)
  return userFeaturesContextHas(
    app.userFeatures.actor.getSnapshot().context,
    OPFS_CLOUD_FEATURE_FLAG,
    false
  )
}

export function loadHomeProjects({
  app,
  closeProject,
}: {
  app: HomeLoaderApp
  closeProject: () => void
}) {
  app.systemIOActor.send({
    type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
  })
  closeProject()
  return {}
}
