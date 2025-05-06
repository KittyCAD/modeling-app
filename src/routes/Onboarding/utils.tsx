import { useCallback, useEffect } from 'react'
import {
  type NavigateFunction,
  type useLocation,
  useNavigate,
} from 'react-router-dom'
import { waitFor } from 'xstate'

import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { useAbsoluteFilePath } from '@src/hooks/useAbsoluteFilePath'
import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import { EngineConnectionStateType } from '@src/lang/std/engineConnection'
import { bracket } from '@src/lib/exampleKcl'
import makeUrlPathRelative from '@src/lib/makeUrlPathRelative'
import { joinRouterPaths, PATHS } from '@src/lib/paths'
import {
  codeManager,
  editorManager,
  kclManager,
  systemIOActor,
} from '@src/lib/singletons'
import { err, reportRejection, trap } from '@src/lib/trap'
import { settingsActor } from '@src/lib/singletons'
import { isKclEmptyOrOnlySettings, parse, resultIsOk } from '@src/lang/wasm'
import { updateModelingState } from '@src/lang/modelingWorkflows'
import {
  DEFAULT_PROJECT_KCL_FILE,
  EXECUTION_TYPE_REAL,
  ONBOARDING_PROJECT_NAME,
} from '@src/lib/constants'
import toast from 'react-hot-toast'
import type CodeManager from '@src/lang/codeManager'
import type { OnboardingStatus } from '@rust/kcl-lib/bindings/OnboardingStatus'
import { isDesktop } from '@src/lib/isDesktop'
import type { KclManager } from '@src/lang/KclSingleton'
import { Logo } from '@src/components/Logo'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import {
  isOnboardingSubPath,
  ONBOARDING_SUBPATHS,
} from '@src/lib/onboardingPaths'

export const kbdClasses =
  'py-0.5 px-1 text-sm rounded bg-chalkboard-10 dark:bg-chalkboard-100 border border-chalkboard-50 border-b-2'

// Get the 1-indexed step number of the current onboarding step
function useStepNumber(
  slug?: (typeof ONBOARDING_SUBPATHS)[keyof typeof ONBOARDING_SUBPATHS]
) {
  return slug ? Object.values(ONBOARDING_SUBPATHS).indexOf(slug) + 1 : -1
}

export function useDemoCode() {
  const { overallState, immediateState } = useNetworkContext()

  useEffect(() => {
    async function setCodeToDemoIfNeeded() {
      // Don't run if the editor isn't loaded or the code is already the bracket
      if (!editorManager.editorView || codeManager.code === bracket) {
        return
      }
      // Don't run if the network isn't healthy or the connection isn't established
      if (
        overallState === NetworkHealthState.Disconnected ||
        overallState === NetworkHealthState.Issue ||
        immediateState.type !== EngineConnectionStateType.ConnectionEstablished
      ) {
        return
      }
      const pResult = parse(bracket)
      if (trap(pResult) || !resultIsOk(pResult)) {
        return Promise.reject(pResult)
      }
      const ast = pResult.program
      await updateModelingState(ast, EXECUTION_TYPE_REAL, {
        kclManager: kclManager,
        editorManager: editorManager,
        codeManager: codeManager,
      })
    }

    setCodeToDemoIfNeeded().catch(reportRejection)
  }, [editorManager.editorView, immediateState.type, overallState])
}

export function useNextClick(newStatus: OnboardingStatus) {
  const filePath = useAbsoluteFilePath()
  const navigate = useNavigate()

  return useCallback(() => {
    if (!isOnboardingSubPath(newStatus)) {
      return new Error(
        `Failed to navigate to invalid onboarding status ${newStatus}`
      )
    }
    settingsActor.send({
      type: 'set.app.onboardingStatus',
      data: { level: 'user', value: newStatus },
    })
    navigate(joinRouterPaths(filePath, PATHS.ONBOARDING.INDEX, newStatus))
  }, [filePath, newStatus, navigate])
}

export function useDismiss() {
  const filePath = useAbsoluteFilePath()
  const send = settingsActor.send
  const navigate = useNavigate()

  const settingsCallback = useCallback(
    (
      dismissalType:
        | Extract<OnboardingStatus, 'completed' | 'dismissed'>
        | undefined = 'dismissed'
    ) => {
      send({
        type: 'set.app.onboardingStatus',
        data: { level: 'user', value: dismissalType },
      })
      waitFor(settingsActor, (state) => state.matches('idle'))
        .then(() => {
          navigate(filePath)
          toast.success(
            'Click the question mark in the lower-right corner if you ever want to redo the tutorial!',
            {
              duration: 5_000,
            }
          )
        })
        .catch(reportRejection)
    },
    [send, filePath, navigate]
  )

  return settingsCallback
}

export function OnboardingButtons({
  currentSlug,
  className,
  dismissClassName,
  onNextOverride,
  ...props
}: {
  currentSlug?: (typeof ONBOARDING_SUBPATHS)[keyof typeof ONBOARDING_SUBPATHS]
  className?: string
  dismissClassName?: string
  onNextOverride?: () => void
} & React.HTMLAttributes<HTMLDivElement>) {
  const onboardingPathsArray = Object.values(ONBOARDING_SUBPATHS)
  const dismiss = useDismiss()
  const stepNumber = useStepNumber(currentSlug)
  const previousStep =
    !stepNumber || stepNumber <= 1 ? null : onboardingPathsArray[stepNumber]
  const nextStep =
    !stepNumber || stepNumber === onboardingPathsArray.length
      ? null
      : onboardingPathsArray[stepNumber]

  const previousOnboardingStatus: OnboardingStatus =
    previousStep ?? ONBOARDING_SUBPATHS.INDEX
  const nextOnboardingStatus: OnboardingStatus = nextStep ?? 'completed'

  const goToPrevious = useNextClick(previousOnboardingStatus)
  const goToNext = useNextClick(nextOnboardingStatus)

  return (
    <>
      <button
        type="button"
        onClick={() => dismiss()}
        className={`group block !absolute left-auto right-full top-[-3px] m-2.5 p-0 border-none bg-transparent hover:bg-transparent ${
          dismissClassName
        }`}
        data-testid="onboarding-dismiss"
      >
        <CustomIcon
          name="close"
          className="w-5 h-5 rounded-sm bg-destroy-10 text-destroy-80 dark:bg-destroy-80 dark:text-destroy-10 group-hover:brightness-110"
        />
        <Tooltip position="bottom">
          Dismiss <kbd className="hotkey ml-4 dark:!bg-chalkboard-80">esc</kbd>
        </Tooltip>
      </button>
      <div
        className={`flex items-center justify-between ${className ?? ''}`}
        {...props}
      >
        <ActionButton
          Element="button"
          onClick={() => (previousStep ? goToPrevious() : dismiss())}
          iconStart={{
            icon: previousStep ? 'arrowLeft' : 'close',
            className: 'text-chalkboard-10',
            bgClassName: 'bg-destroy-80 group-hover:bg-destroy-80',
          }}
          className="hover:border-destroy-40 hover:bg-destroy-10/50 dark:hover:bg-destroy-80/50"
          data-testid="onboarding-prev"
        >
          {previousStep ? 'Back' : 'Dismiss'}
        </ActionButton>
        {stepNumber !== undefined && (
          <p className="font-mono text-xs text-center m-0">
            {stepNumber} / {onboardingPathsArray.length}
          </p>
        )}
        <ActionButton
          autoFocus
          Element="button"
          onClick={() => {
            if (nextStep) {
              const result = onNextOverride ? onNextOverride() : goToNext()
              if (err(result)) {
                reportRejection(result)
              }
            } else {
              dismiss('completed')
            }
          }}
          iconStart={{
            icon: nextStep ? 'arrowRight' : 'checkmark',
            bgClassName: 'dark:bg-chalkboard-80',
          }}
          className="dark:hover:bg-chalkboard-80/50"
          data-testid="onboarding-next"
        >
          {nextStep ? 'Next' : 'Finish'}
        </ActionButton>
      </div>
    </>
  )
}

export interface OnboardingUtilDeps {
  onboardingStatus: OnboardingStatus
  codeManager: CodeManager
  kclManager: KclManager
  navigate: NavigateFunction
}

export const ERROR_MUST_WARN = 'Must warn user before overwrite'

/**
 * Accept to begin the onboarding tutorial,
 * depending on the platform and the state of the user's code.
 */
export async function acceptOnboarding(deps: OnboardingUtilDeps) {
  if (isDesktop()) {
    /** TODO: rename this event to be more generic, like `createKCLFileAndNavigate` */
    systemIOActor.send({
      type: SystemIOMachineEvents.importFileFromURL,
      data: {
        requestedProjectName: ONBOARDING_PROJECT_NAME,
        requestedFileNameWithExtension: DEFAULT_PROJECT_KCL_FILE,
        requestedCode: bracket,
        requestedSubRoute: joinRouterPaths(
          PATHS.ONBOARDING.INDEX,
          deps.onboardingStatus
        ),
      },
    })
    return Promise.resolve()
  }

  const isCodeResettable = hasResetReadyCode(deps.codeManager)
  if (isCodeResettable) {
    return resetCodeAndAdvanceOnboarding(deps)
  }

  return Promise.reject(new Error(ERROR_MUST_WARN))
}

/**
 * Given that the user has accepted overwriting their web editor,
 * advance to the next step and clear their editor.
 */
export async function resetCodeAndAdvanceOnboarding({
  onboardingStatus,
  codeManager,
  kclManager,
  navigate,
}: OnboardingUtilDeps) {
  // We do want to update both the state and editor here.
  codeManager.updateCodeStateEditor(bracket)
  codeManager.writeToFile().catch(reportRejection)
  kclManager.executeCode().catch(reportRejection)
  navigate(
    makeUrlPathRelative(
      joinRouterPaths(PATHS.ONBOARDING.INDEX, onboardingStatus)
    )
  )
}

function hasResetReadyCode(codeManager: CodeManager) {
  return (
    isKclEmptyOrOnlySettings(codeManager.code) || codeManager.code === bracket
  )
}

export function needsToOnboard(
  location: ReturnType<typeof useLocation>,
  onboardingStatus: OnboardingStatus
) {
  return (
    !location.pathname.includes(PATHS.ONBOARDING.INDEX) &&
    (onboardingStatus.length === 0 ||
      !(onboardingStatus === 'completed' || onboardingStatus === 'dismissed'))
  )
}

export const ONBOARDING_TOAST_ID = 'onboarding-toast'

export function onDismissOnboardingInvite() {
  settingsActor.send({
    type: 'set.app.onboardingStatus',
    data: { level: 'user', value: 'dismissed' },
  })
  toast.dismiss(ONBOARDING_TOAST_ID)
  toast.success(
    'Click the question mark in the lower-right corner if you ever want to do the tutorial!',
    {
      duration: 5_000,
    }
  )
}

export function TutorialRequestToast(props: OnboardingUtilDeps) {
  function onAccept() {
    acceptOnboarding(props)
      .then(() => {
        toast.dismiss(ONBOARDING_TOAST_ID)
      })
      .catch((reason) => catchOnboardingWarnError(reason, props))
  }

  return (
    <div
      data-testid="onboarding-toast"
      className="flex items-center gap-6 min-w-80"
    >
      <Logo className="w-auto h-8 flex-none" />
      <div className="flex flex-col justify-between gap-6">
        <section>
          <h2>Welcome to Zoo Design Studio</h2>
          <p className="text-sm text-chalkboard-70 dark:text-chalkboard-30">
            Would you like a tutorial to show you around the app?
          </p>
        </section>
        <div className="flex justify-between gap-8">
          <ActionButton
            Element="button"
            iconStart={{
              icon: 'close',
            }}
            data-negative-button="dismiss"
            name="dismiss"
            onClick={onDismissOnboardingInvite}
          >
            Not right now
          </ActionButton>
          <ActionButton
            Element="button"
            iconStart={{
              icon: 'checkmark',
            }}
            name="accept"
            onClick={onAccept}
          >
            Get started
          </ActionButton>
        </div>
      </div>
    </div>
  )
}

/**
 * Helper function to catch the `ERROR_MUST_WARN` error from
 * `acceptOnboarding` and show a warning toast.
 */
export async function catchOnboardingWarnError(
  err: Error,
  props: OnboardingUtilDeps
) {
  if (err instanceof Error && err.message === ERROR_MUST_WARN) {
    toast.success(TutorialWebConfirmationToast(props), {
      id: ONBOARDING_TOAST_ID,
      duration: Number.POSITIVE_INFINITY,
      icon: null,
    })
  } else {
    toast.dismiss(ONBOARDING_TOAST_ID)
    return reportRejection(err)
  }
}

export function TutorialWebConfirmationToast(props: OnboardingUtilDeps) {
  function onAccept() {
    toast.dismiss(ONBOARDING_TOAST_ID)
    resetCodeAndAdvanceOnboarding(props).catch(reportRejection)
  }

  return (
    <div
      data-testid="onboarding-toast-confirmation"
      className="flex items-center gap-6 min-w-80"
    >
      <Logo className="w-auto h-8 flex-none" />
      <div className="flex flex-col justify-between gap-6">
        <section>
          <h2>The welcome tutorial resets your code in the browser</h2>
          <p className="text-sm text-chalkboard-70 dark:text-chalkboard-30">
            We see you have some of your own code written in this project.
            Please save it somewhere else before continuing the onboarding.
          </p>
        </section>
        <div className="flex justify-between gap-8">
          <ActionButton
            Element="button"
            iconStart={{
              icon: 'close',
            }}
            data-negative-button="dismiss"
            name="dismiss"
            onClick={onDismissOnboardingInvite}
          >
            I'll save it
          </ActionButton>
          <ActionButton
            Element="button"
            iconStart={{
              icon: 'checkmark',
            }}
            name="accept"
            onClick={onAccept}
          >
            Overwrite and begin
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
