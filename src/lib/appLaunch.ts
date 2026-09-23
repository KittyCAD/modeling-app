import {
  effect,
  type ReadonlySignal,
  signal,
  untracked,
} from '@preact/signals-core'
import type {
  AppLaunchInput,
  AppLaunchService,
} from '@src/registry/contracts/appLaunch'
import type { AppNavigationService } from '@src/registry/contracts/appNavigation'

export interface LaunchExecution {
  signal: AbortSignal
  openProject: AppNavigationService['openProject']
}

export interface AppLaunchDependencies {
  isLoggedIn: ReadonlySignal<boolean>
  navigation: Pick<AppNavigationService, 'intentRevision' | 'openProject'>
  isDesktop: boolean
  execute: (input: AppLaunchInput, execution: LaunchExecution) => Promise<void>
  chooseWeb: (input: AppLaunchInput) => Promise<void>
  reportError: (error: unknown) => void
}

/** Claim work before dispatch; neither URL projection nor React mounts replay it. */
export function createAppLaunchService(
  deps: AppLaunchDependencies
): AppLaunchService {
  const pending = signal(false)
  let active:
    | {
        input: AppLaunchInput
        controller: AbortController
        waitingForChoice: boolean
        promise?: Promise<void>
        choicePromise?: Promise<void>
      }
    | undefined
  let ownNavigation = false
  let disposed = false
  let revision = deps.navigation.intentRevision.peek()

  const cancel = () => {
    active?.controller.abort()
    active = undefined
    pending.value = false
  }

  const run = (): Promise<void> => {
    const launch = active
    if (!launch || launch.waitingForChoice || !deps.isLoggedIn.peek()) {
      return Promise.resolve()
    }
    if (launch.promise) return launch.promise

    const execution: LaunchExecution = {
      signal: launch.controller.signal,
      openProject: (request) => {
        launch.controller.signal.throwIfAborted()
        ownNavigation = true
        try {
          return deps.navigation.openProject({
            ...request,
            signal: launch.controller.signal,
          })
        } finally {
          // A signal batch can delay the observer until after this call returns.
          // Remember the owned revision so that deferred notification is safe.
          revision = deps.navigation.intentRevision.peek()
          ownNavigation = false
        }
      },
    }
    // Store the promise before calling dependencies, which can notify observers
    // synchronously (command registration, auth refresh, project publication).
    launch.promise = Promise.resolve()
      .then(() => {
        execution.signal.throwIfAborted()
        return deps.execute(launch.input, execution)
      })
      .catch((error: unknown) => {
        if (!execution.signal.aborted) deps.reportError(error)
      })
      .finally(() => {
        if (active === launch) {
          active = undefined
          pending.value = false
        }
      })
    return launch.promise
  }

  const stop = effect(() => {
    const nextRevision = deps.navigation.intentRevision.value
    const loggedIn = deps.isLoggedIn.value
    untracked(() => {
      if (nextRevision !== revision) {
        revision = nextRevision
        if (!ownNavigation) cancel()
      }
      if (!loggedIn && active?.promise) cancel()
      void run()
    })
  })

  return {
    pending,
    accept: (input) => {
      if (disposed) return Promise.resolve()
      cancel()
      active = {
        input,
        controller: new AbortController(),
        waitingForChoice: !deps.isDesktop && input.request.askOpenDesktop,
      }
      pending.value = true
      return run()
    },
    continueInWeb: () => {
      const launch = active
      if (!launch || !launch.waitingForChoice) return Promise.resolve()
      if (launch.choicePromise) return launch.choicePromise
      launch.choicePromise = Promise.resolve()
        .then(() => {
          launch.controller.signal.throwIfAborted()
          return deps.chooseWeb(launch.input)
        })
        .then(() => {
          if (active !== launch) return
          launch.waitingForChoice = false
          return run()
        })
        .catch((error: unknown) => {
          if (!launch.controller.signal.aborted) return Promise.reject(error)
        })
        .finally(() => {
          launch.choicePromise = undefined
        })
      return launch.choicePromise
    },
    cancel,
    dispose: () => {
      disposed = true
      stop()
      cancel()
    },
  }
}
