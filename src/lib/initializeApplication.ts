import type { App } from '@src/lib/app'
import { appNavigationService } from '@src/registry/contracts/appNavigation'
import { startSignInIntent } from '@src/registry/contracts/auth'
import { appUrlService } from '@src/registry/contracts/appUrl'
import { showHomeIntent } from '@src/registry/contracts/homeProjects'
import { openProjectIntent } from '@src/registry/contracts/projectSession'
import { waitFor } from 'xstate'

/**
 * Restore application state from the URL once, before React is mounted.
 *
 * The URL is parsed once into capability-owned application intents. Those
 * intents establish state directly; URL projection happens only after the
 * state has been established.
 */
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
  const appNavigation = app.registry.get(appNavigationService)
  const intent = appUrl.readInitialUrl({ requestUrl, usesHashRouter })
  if (intent.type === 'unrecognized') {
    return
  }

  const destination = intent.destination
  const urlState = {
    ...(intent.additionalIntents
      ? { additionalIntents: intent.additionalIntents }
      : {}),
    search: intent.search,
    hash: intent.hash,
  }
  switch (destination.type) {
    case 'index':
      // The sole remaining index intent lets OpenInDesktopAppHandler own its
      // modal without entering another application destination.
      return
    case 'home':
      await appNavigation.dispatch(showHomeIntent, {
        ...(destination.libraryId ? { libraryId: destination.libraryId } : {}),
        startup: urlState,
      })
      break
    case 'project':
      await appNavigation.dispatch(openProjectIntent, {
        target: destination.target,
        startup: urlState,
      })
      break
    case 'cloud-project': {
      const auth = await waitFor(
        app.auth.actor,
        (state) => state.matches('loggedIn') || state.matches('loggedOut')
      )
      if (!auth.matches('loggedIn')) {
        const returnTo = appUrl.formatUrl({ destination, ...urlState })
        const search = `?returnTo=${encodeURIComponent(returnTo)}`
        await appUrl.navigate(`/signin${search}`, { replace: true })
        await appNavigation.dispatch(startSignInIntent, {
          reason: 'startup',
          startup: { search, hash: '' },
        })
        return
      }
      await appNavigation.dispatch(openProjectIntent, {
        cloudProjectId: destination.projectId,
        target: destination.file ?? '',
        startup: urlState,
      })
      break
    }
    case 'sign-in':
      await appNavigation.dispatch(startSignInIntent, {
        reason: 'startup',
        startup: urlState,
      })
      break
  }

  for (const additionalIntent of urlState.additionalIntents ?? []) {
    await appNavigation.dispatch(
      additionalIntent.intent,
      additionalIntent.input
    )
  }

  if (intent.shouldProjectUrl && destination.type !== 'project') {
    void appUrl.navigate(appUrl.formatUrl({ destination, ...urlState }), {
      replace: true,
    })
  }
}
