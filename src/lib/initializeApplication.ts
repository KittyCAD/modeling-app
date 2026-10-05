import type { App } from '@src/lib/app'
import type { LaunchExecution } from '@src/lib/appLaunch'
import { parseLaunchRequest } from '@src/lib/launchRequest'
import { appLaunchService } from '@src/registry/contracts/appLaunch'
import {
  appNavigationService,
  type AppNavigationService,
} from '@src/registry/contracts/appNavigation'
import { startSignInIntent } from '@src/registry/contracts/auth'
import {
  appUrlService,
  type InitialUrlIntent,
} from '@src/registry/contracts/appUrl'
import { showHomeIntent } from '@src/registry/contracts/homeProjects'
import { openProjectIntent } from '@src/registry/contracts/projectSession'

/** Restore the initial destination, or hand one-shot work to its launch owner. */
export async function initializeApplication(
  app: App,
  {
    requestUrl = window.location.href,
    usesHashRouter = Boolean(window.electron),
  }: {
    requestUrl?: string
    usesHashRouter?: boolean
  } = {}
): Promise<void> {
  const appUrl = app.registry.get(appUrlService)
  const intent = appUrl.readInitialUrl({ requestUrl, usesHashRouter })
  if (intent.type === 'unrecognized') return

  const { request, remainingSearch } = parseLaunchRequest(intent.search)
  if (request) {
    // Keep the transferable URL through authentication and the desktop choice.
    // Acceptance must not block React: some commands register when views mount.
    void app.registry.get(appLaunchService).accept({
      destination: intent.destination,
      urlState: {
        ...(intent.additionalIntents
          ? { additionalIntents: intent.additionalIntents }
          : {}),
        search: intent.search,
        hash: intent.hash,
      },
      request,
      remainingSearch,
    })
    return
  }
  await restoreApplicationDestination(app, intent)
}

/** Establish a parsed destination through its owning capabilities. */
export async function restoreApplicationDestination(
  app: App,
  intent: Extract<InitialUrlIntent, { type: 'launch' }>,
  options: {
    openProject?: LaunchExecution['openProject']
    dispatch?: AppNavigationService['dispatch']
    signal?: AbortSignal
    projectUrl?: boolean
  } = {}
): Promise<void> {
  const appUrl = app.registry.get(appUrlService)
  const dispatch =
    options.dispatch ?? app.registry.get(appNavigationService).dispatch
  const destination = intent.destination
  const urlState = {
    ...(intent.additionalIntents
      ? { additionalIntents: intent.additionalIntents }
      : {}),
    search: intent.search,
    hash: intent.hash,
  }
  options.signal?.throwIfAborted()
  switch (destination.type) {
    case 'index':
      return
    case 'home':
      await dispatch(showHomeIntent, {
        ...(destination.libraryId ? { libraryId: destination.libraryId } : {}),
        startup: urlState,
      })
      break
    case 'project': {
      const request = { target: destination.target, startup: urlState }
      await (options.openProject
        ? options.openProject(request)
        : dispatch(openProjectIntent, request))
      break
    }
    case 'sign-in':
      await dispatch(startSignInIntent, {
        reason: 'startup',
        startup: urlState,
      })
      break
  }
  options.signal?.throwIfAborted()

  for (const additionalIntent of urlState.additionalIntents ?? []) {
    await dispatch(additionalIntent.intent, additionalIntent.input)
    options.signal?.throwIfAborted()
  }

  if (
    (options.projectUrl || intent.shouldProjectUrl) &&
    destination.type !== 'project'
  ) {
    await appUrl.navigate(appUrl.formatUrl({ destination, ...urlState }), {
      replace: true,
    })
    options.signal?.throwIfAborted()
  }
}
