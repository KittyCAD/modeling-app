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
import { startSignInIntent } from '@src/registry/contracts/auth'
import {
  openProjectIntent,
  type OpenProjectRequest,
  type OpenProjectOutcome,
} from '@src/registry/contracts/projectSession'

export interface LaunchExecution {
  signal: AbortSignal
  dispatch: AppNavigationService['dispatch']
  openProject: (request: OpenProjectRequest) => Promise<OpenProjectOutcome>
}

export interface AppLaunchDependencies {
  isLoggedIn: ReadonlySignal<boolean>
  navigation: Pick<AppNavigationService, 'primaryIntentStarted' | 'dispatch'>
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
  let previousIntent = deps.navigation.primaryIntentStarted.peek()

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

    const dispatch: AppNavigationService['dispatch'] = (intent, input) => {
      launch.controller.signal.throwIfAborted()
      ownNavigation = true
      try {
        return deps.navigation.dispatch(intent, input)
      } finally {
        // A signal batch can delay the observer until after this call returns.
        previousIntent = deps.navigation.primaryIntentStarted.peek()
        ownNavigation = false
      }
    }
    const execution: LaunchExecution = {
      signal: launch.controller.signal,
      dispatch,
      openProject: (request) =>
        dispatch(openProjectIntent, {
          ...request,
          signal: launch.controller.signal,
        }),
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
    const started = deps.navigation.primaryIntentStarted.value
    const loggedIn = deps.isLoggedIn.value
    untracked(() => {
      if (started !== previousIntent) {
        previousIntent = started
        if (
          !ownNavigation &&
          started &&
          started.intent.id !== startSignInIntent.id
        ) {
          cancel()
        }
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
