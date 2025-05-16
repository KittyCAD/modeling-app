import { useCallback, useEffect, useState } from 'react'
import {
  type NavigateFunction,
  type useLocation,
  useNavigate,
} from 'react-router-dom'
import { type SnapshotFrom, waitFor } from 'xstate'

import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { useAbsoluteFilePath } from '@src/hooks/useAbsoluteFilePath'
import { browserAxialFan, fanParts } from '@src/lib/exampleKcl'
import makeUrlPathRelative from '@src/lib/makeUrlPathRelative'
import { joinRouterPaths, PATHS } from '@src/lib/paths'
import { commandBarActor, systemIOActor } from '@src/lib/singletons'
import { err, reportRejection } from '@src/lib/trap'
import { settingsActor } from '@src/lib/singletons'
import { isKclEmptyOrOnlySettings } from '@src/lang/wasm'
import {
  ONBOARDING_DATA_ATTRIBUTE,
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
  isOnboardingPath,
  type OnboardingPath,
  onboardingPaths,
  onboardingStartPath,
} from '@src/lib/onboardingPaths'
import { useModelingContext } from '@src/hooks/useModelingContext'
import type { SidebarType } from '@src/components/ModelingSidebar/ModelingPanes'

export const kbdClasses =
  'py-0.5 px-1 text-sm rounded bg-chalkboard-10 dark:bg-chalkboard-100 border border-chalkboard-50 border-b-2'

// Get the 1-indexed step number of the current onboarding step
function getStepNumber(
  slug?: OnboardingPath,
  platform: keyof typeof onboardingPaths = 'browser'
) {
  return slug ? Object.values(onboardingPaths[platform]).indexOf(slug) + 1 : -1
}

export const OnboardingCard = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={`relative max-w-3xl min-w-80 cursor-auto bg-chalkboard-10 dark:bg-chalkboard-90 py-6 px-8 rounded border border-chalkboard-50 dark:border-chalkboard-80 shadow-lg ${className || ''}`}
    {...props}
  >
    {children}
  </div>
)

export function useNextClick(newStatus: OnboardingStatus) {
  const filePath = useAbsoluteFilePath()
  const navigate = useNavigate()

  return useCallback(() => {
    if (!isOnboardingPath(newStatus)) {
      return new Error(
        `Failed to navigate to invalid onboarding status ${newStatus}`
      )
    }
    settingsActor.send({
      type: 'set.app.onboardingStatus',
      data: { level: 'user', value: newStatus },
    })
    const targetRoute = joinRouterPaths(filePath, PATHS.ONBOARDING, newStatus)
    navigate(targetRoute)
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

export function useAdjacentOnboardingSteps(
  currentSlug?: OnboardingPath,
  platform: undefined | keyof typeof onboardingPaths = 'browser'
) {
  const onboardingPathsArray = Object.values(onboardingPaths[platform])
  const stepNumber = getStepNumber(currentSlug, platform)
  const previousStep =
    !stepNumber || stepNumber <= 1 ? null : onboardingPathsArray[stepNumber - 2]
  const nextStep =
    !stepNumber || stepNumber === onboardingPathsArray.length
      ? null
      : onboardingPathsArray[stepNumber]

  const previousOnboardingStatus: OnboardingStatus = previousStep ?? 'dismissed'
  const nextOnboardingStatus: OnboardingStatus = nextStep ?? 'completed'

  return [previousOnboardingStatus, nextOnboardingStatus]
}

export function useOnboardingClicks(
  currentSlug?: OnboardingPath,
  platform: undefined | keyof typeof onboardingPaths = 'browser'
) {
  const [previousOnboardingStatus, nextOnboardingStatus] =
    useAdjacentOnboardingSteps(currentSlug, platform)
  const goToPrevious = useNextClick(previousOnboardingStatus)
  const goToNext = useNextClick(nextOnboardingStatus)

  return [goToPrevious, goToNext]
}

export function OnboardingButtons({
  currentSlug,
  platform = 'browser',
  dismissPosition = 'left',
  className,
  dismissClassName,
  onNextOverride,
  ...props
}: {
  currentSlug?: OnboardingPath
  platform?: keyof typeof onboardingPaths
  dismissPosition?: 'left' | 'right'
  className?: string
  dismissClassName?: string
  onNextOverride?: () => void
} & React.HTMLAttributes<HTMLDivElement>) {
  const dismiss = useDismiss()
  const onboardingPathsArray = Object.values(onboardingPaths[platform])
  const stepNumber = getStepNumber(currentSlug, platform)
  const [previousStep, nextStep] = useAdjacentOnboardingSteps(
    currentSlug,
    platform
  )
  const [goToPrevious, goToNext] = useOnboardingClicks(currentSlug, platform)

  return (
    <>
      <button
        type="button"
        onClick={() => dismiss()}
        className={`group block !absolute top-[-3px] m-2.5 p-0 border-none bg-transparent hover:bg-transparent ${
          dismissClassName
        }`}
        style={{
          left: dismissPosition === 'left' ? 'auto' : '100%',
          right: dismissPosition === 'left' ? '100%' : 'auto',
        }}
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
          onClick={() =>
            previousStep && previousStep !== 'dismissed'
              ? goToPrevious()
              : dismiss()
          }
          iconStart={{
            icon:
              previousStep && previousStep !== 'dismissed'
                ? 'arrowLeft'
                : 'close',
            className: 'text-chalkboard-10',
            bgClassName: 'bg-destroy-80 group-hover:bg-destroy-80',
          }}
          className="hover:border-destroy-40 hover:bg-destroy-10/50 dark:hover:bg-destroy-80/50"
          data-testid="onboarding-prev"
          id="onboarding-prev"
          tabIndex={0}
        >
          {previousStep && previousStep !== 'dismissed' ? 'Back' : 'Dismiss'}
        </ActionButton>
        {stepNumber !== undefined && (
          <p className="font-mono text-xs text-center m-0">
            {stepNumber} / {onboardingPathsArray.length}
          </p>
        )}
        <ActionButton
          autoFocus
          tabIndex={0}
          Element="button"
          onClick={() => {
            if (nextStep && nextStep !== 'completed') {
              const result = onNextOverride ? onNextOverride() : goToNext()
              if (err(result)) {
                reportRejection(result)
              }
            } else {
              dismiss('completed')
            }
          }}
          iconStart={{
            icon:
              nextStep && nextStep !== 'completed' ? 'arrowRight' : 'checkmark',
            bgClassName: 'dark:bg-chalkboard-80',
          }}
          className="dark:hover:bg-chalkboard-80/50"
          data-testid="onboarding-next"
          id="onboarding-next"
        >
          {nextStep && nextStep !== 'completed' ? 'Next' : 'Finish'}
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
  // Non-path statuses should be coerced to the start path
  const onboardingStatus = !isOnboardingPath(deps.onboardingStatus)
    ? onboardingStartPath
    : deps.onboardingStatus
  if (isDesktop()) {
    /**
     * Bulk create the assembly and navigate to the project
     */
    systemIOActor.send({
      type: SystemIOMachineEvents.bulkCreateKCLFilesAndNavigateToProject,
      data: {
        files: fanParts.map((part) => ({
          requestedProjectName: ONBOARDING_PROJECT_NAME,
          ...part,
        })),
        // Make a unique tutorial project each time
        override: true,
        requestedProjectName: ONBOARDING_PROJECT_NAME,
        requestedSubRoute: joinRouterPaths(PATHS.ONBOARDING, onboardingStatus),
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
  // Non-path statuses should be coerced to the start path
  const resolvedOnboardingStatus = !isOnboardingPath(onboardingStatus)
    ? onboardingStartPath
    : onboardingStatus
  // We do want to update both the state and editor here.
  codeManager.updateCodeStateEditor(browserAxialFan)
  codeManager.writeToFile().catch(reportRejection)
  kclManager.executeCode().catch(reportRejection)
  navigate(
    makeUrlPathRelative(
      joinRouterPaths(String(PATHS.ONBOARDING), resolvedOnboardingStatus)
    )
  )
}

function hasResetReadyCode(codeManager: CodeManager) {
  return (
    isKclEmptyOrOnlySettings(codeManager.code) ||
    codeManager.code === browserAxialFan
  )
}

export function needsToOnboard(
  location: ReturnType<typeof useLocation>,
  onboardingStatus: OnboardingStatus
) {
  return (
    !location.pathname.includes(String(PATHS.ONBOARDING)) &&
    (onboardingStatus.length === 0 ||
      !(onboardingStatus === 'completed' || onboardingStatus === 'dismissed'))
  )
}

export const ONBOARDING_TOAST_ID = 'onboarding-toast'
export const DOWNLOAD_APP_TOAST_ID = 'download-app-toast'

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
    <div data-testid="onboarding-toast" className="flex items-center gap-6">
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

/**
 * Find the the element with a given `data-onboarding-id` attribute
 * and highlight it on mount, unhighlighting on unmount.
 */
export function useOnboardingHighlight(elementId: string) {
  useEffect(() => {
    const elementToHighlight = document.querySelector(
      `[data-${ONBOARDING_DATA_ATTRIBUTE}="${elementId}"`
    )
    if (elementToHighlight === null) {
      console.error('Text-to-CAD dropdown element not found')
      return
    }
    // There is an ".onboarding-highlight" class defined in index.css
    elementToHighlight?.classList.add('onboarding-highlight')

    // Remove the highlight on unmount
    return () => {
      elementToHighlight?.classList.remove('onboarding-highlight')
    }
  }, [elementId])
}

/**
 * Utility hook to set the pane state on mount and unmount.
 */
export function useOnboardingPanes(
  onMount: SidebarType[] | undefined = [],
  onUnmount: SidebarType[] | undefined = []
) {
  const { send } = useModelingContext()
  useEffect(() => {
    send({
      type: 'Set context',
      data: {
        openPanes: onMount,
      },
    })

    return () =>
      send({
        type: 'Set context',
        data: {
          openPanes: onUnmount,
        },
      })
  }, [send])
}

export function isModelingCmdGroupReady(
  state: SnapshotFrom<typeof commandBarActor>
) {
  // Ensure that the modeling command group is available
  if (
    state.context.commands.some((command) => command.groupId === 'modeling')
  ) {
    return true
  }

  return false
}

/**
 * Utility onboarding hook to wait for the engine connection to be established
 */
export function useOnModelingCmdGroupReadyOnce(
  callback: () => void,
  deps: React.DependencyList
) {
  const [isReadyOnce, setReadyOnce] = useState(false)

  // Set up a subscription to the command bar actor's
  // modeling command group
  useEffect(() => {
    const isReadyNow = isModelingCmdGroupReady(commandBarActor.getSnapshot())
    if (isReadyNow) {
      setReadyOnce(true)
    } else {
      const subscription = commandBarActor.subscribe((state) => {
        if (isModelingCmdGroupReady(state)) {
          setReadyOnce(true)
        }
      })
      return () => subscription.unsubscribe()
    }
  }, [])

  // Fire the callback when the modeling command group is ready
  useEffect(() => {
    if (isReadyOnce) {
      callback()
    }
  }, [isReadyOnce, ...deps])
}

/**
 * If your onboarding step opens the command palette it will mess with keyboard focus.
 * To side-step this, use this hook to override a form submission to advance the onboarding.
 */
export function useAdvanceOnboardingOnFormSubmit(
  currentSlug?: OnboardingPath,
  platform: undefined | keyof typeof onboardingPaths = 'browser'
) {
  const [_prev, goToNext] = useOnboardingClicks(currentSlug, platform)

  useEffect(() => {
    // Override form submission events so the command palette can't be submitted
    const formSubmitListener = (e: SubmitEvent) => {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      goToNext()
    }
    window.addEventListener('submit', formSubmitListener)
    // Remove the listener when we leave
    return () => {
      window.removeEventListener('submit', formSubmitListener)
    }
  }, [goToNext])
}
