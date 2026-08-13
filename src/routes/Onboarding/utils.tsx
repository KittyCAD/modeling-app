import { useCallback, useEffect, useState } from 'react'
import {
  type NavigateFunction,
  type useLocation,
  useNavigate,
} from 'react-router-dom'
import { type ActorRefFrom, type SnapshotFrom, waitFor } from 'xstate'

import onboardingWorkflowAiHeadset from '@src/assets/onboarding-workflow-ai-headset.png'
import onboardingWorkflowKitt from '@src/assets/onboarding-workflow-kitt.png'
import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon, type CustomIconName } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { useAbsoluteFilePath } from '@src/hooks/useAbsoluteFilePath'
import type { App } from '@src/lib/app'
import { useApp } from '@src/lib/boot'
import {
  ONBOARDING_DATA_ATTRIBUTE,
  ONBOARDING_PROJECT_NAME,
  ONBOARDING_TOAST_ID,
} from '@src/lib/constants'
import { coldPlateParts } from '@src/lib/exampleKcl'
import {
  DefaultLayoutPaneID,
  defaultLayout,
  setOpenPanes,
} from '@src/lib/layout'
import {
  type OnboardingPath,
  type OnboardingStatus,
  isOnboardingPath,
  onboardingPaths,
  onboardingStartPath,
} from '@src/lib/onboardingPaths'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import {
  PATHS,
  joinRouterPaths,
  safeEncodeForRouterPaths,
} from '@src/lib/paths'
import {
  DEFAULT_PROJECT_LIBRARY_ID,
  PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
} from '@src/lib/projectLibraries'
import { waitForToastAnimationEnd } from '@src/lib/toast'
import { err, reportRejection, trap } from '@src/lib/trap'
import type { commandBarMachine } from '@src/machines/commandBarMachine'
import type { SettingsActorType } from '@src/machines/settingsMachine'
import toast from 'react-hot-toast'

// Get the 1-indexed step number of the current onboarding step
function getStepNumber(
  slug?: OnboardingPath,
  platform: keyof typeof onboardingPaths = 'desktop'
) {
  return slug ? Object.values(onboardingPaths[platform]).indexOf(slug) + 1 : -1
}

export type OnboardingWorkflowPreference = 'ai' | 'code' | 'sketch'

const preferredWorkflowPaneMap: Record<
  OnboardingWorkflowPreference,
  DefaultLayoutPaneID[]
> = {
  ai: [DefaultLayoutPaneID.Zookeeper],
  code: [
    DefaultLayoutPaneID.Code,
    DefaultLayoutPaneID.Files,
    DefaultLayoutPaneID.Variables,
  ],
  sketch: [DefaultLayoutPaneID.FeatureTree],
}

let rememberedOnboardingWorkflowPreference: OnboardingWorkflowPreference | null =
  null

export function consumeRememberedOnboardingWorkflowPanes():
  | DefaultLayoutPaneID[]
  | null {
  if (!rememberedOnboardingWorkflowPreference) {
    return null
  }

  const preferredOpenPanes =
    preferredWorkflowPaneMap[rememberedOnboardingWorkflowPreference]
  rememberedOnboardingWorkflowPreference = null
  return [...preferredOpenPanes]
}

export function shouldApplyRememberedOnboardingWorkflow(
  pathname: string,
  onboardingStatus: OnboardingStatus
) {
  return (
    !pathname.includes(String(PATHS.ONBOARDING)) &&
    (onboardingStatus === 'completed' || onboardingStatus === 'dismissed')
  )
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
  const { settings } = useApp()
  const filePath = useAbsoluteFilePath()
  const navigate = useNavigate()

  return useCallback(() => {
    if (!filePath) {
      return new Error(`filePath is undefined`)
    }

    if (!isOnboardingPath(newStatus)) {
      return new Error(
        `Failed to navigate to invalid onboarding status ${newStatus}`
      )
    }
    settings.send({
      type: 'set.app.onboardingStatus',
      data: { level: 'user', value: newStatus },
    })
    const targetRoute = joinRouterPaths(filePath, PATHS.ONBOARDING, newStatus)
    void navigate(targetRoute, { replace: true })
  }, [filePath, newStatus, navigate, settings])
}

export function useDismiss() {
  const { settings } = useApp()
  const navigate = useNavigate()

  const settingsCallback = useCallback(
    (
      dismissalType:
        | Extract<OnboardingStatus, 'completed' | 'dismissed'>
        | undefined = 'dismissed'
    ) => {
      waitFor(settings.actor, (state) => state.matches('idle'))
        .then(() => {
          settings.send({
            type: 'set.app.onboardingStatus',
            data: { level: 'user', value: dismissalType },
          })
          return waitFor(settings.actor, (state) => state.matches('idle'))
        })
        .then(() => {
          void navigate(PATHS.HOME, { replace: true })
          toast.success(
            'Click the question mark in the lower-right corner if you ever want to redo the tutorial!',
            {
              duration: 5_000,
            }
          )
        })
        .catch(reportRejection)
    },
    [settings, navigate]
  )

  return settingsCallback
}

export function useAdjacentOnboardingSteps(
  currentSlug?: OnboardingPath,
  platform: undefined | keyof typeof onboardingPaths = 'desktop'
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
  platform: undefined | keyof typeof onboardingPaths = 'desktop'
) {
  const [previousOnboardingStatus, nextOnboardingStatus] =
    useAdjacentOnboardingSteps(currentSlug, platform)
  const goToPrevious = useNextClick(previousOnboardingStatus)
  const goToNext = useNextClick(nextOnboardingStatus)

  return [goToPrevious, goToNext]
}

export function OnboardingButtons({
  currentSlug,
  platform = 'desktop',
  dismissPosition = 'left',
  hideNext = false,
  className,
  dismissClassName,
  onNextOverride,
  ...props
}: {
  currentSlug?: OnboardingPath
  platform?: keyof typeof onboardingPaths
  dismissPosition?: 'left' | 'right'
  hideNext?: boolean
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
                ? 'arrowShortLeft'
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
        {hideNext ? (
          <div className="w-[72px]" aria-hidden />
        ) : (
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
                nextStep && nextStep !== 'completed'
                  ? 'arrowShortRight'
                  : 'checkmark',
              bgClassName: 'dark:bg-chalkboard-80',
            }}
            className="dark:hover:bg-chalkboard-80/50"
            data-testid="onboarding-next"
            id="onboarding-next"
          >
            {nextStep && nextStep !== 'completed' ? 'Next' : 'Finish'}
          </ActionButton>
        )}
      </div>
    </>
  )
}

export interface OnboardingUtilDeps {
  app: Pick<App, 'getCreateProjectLibraryTargets'>
  onboardingStatus: OnboardingStatus
  navigate: NavigateFunction
}

let pendingOnboardingStart: Promise<void> | undefined

async function createOnboardingProject(
  deps: OnboardingUtilDeps,
  onboardingStatus: OnboardingStatus
) {
  const targets = deps.app.getCreateProjectLibraryTargets()
  const isDesktopApp = typeof window !== 'undefined' && Boolean(window.electron)
  const preferredLibraryId = isDesktopApp
    ? DEFAULT_PROJECT_LIBRARY_ID
    : PERSONAL_CLOUD_PROJECT_LIBRARY_ID
  const projectLibraryTarget =
    targets.find((target) => target.library.id === preferredLibraryId) ??
    (isDesktopApp
      ? targets.find(
          (target) => target.library.id === PERSONAL_CLOUD_PROJECT_LIBRARY_ID
        )
      : undefined) ??
    targets[0]

  if (!projectLibraryTarget) {
    return Promise.reject(
      new Error('No writable project library is available for onboarding.')
    )
  }

  const initialKclFile = coldPlateParts[0]
  const project = await projectLibraryTarget.createProject.run({
    library: projectLibraryTarget.library,
    requestedProjectName: ONBOARDING_PROJECT_NAME,
    requestedProjectTitle: ONBOARDING_PROJECT_NAME,
    // Write the tutorial before cloud enrollment can observe a blank project.
    initialKclFile: {
      fileName: initialKclFile.requestedFileName,
      code: initialKclFile.requestedCode,
    },
  })

  if (!project?.default_file) {
    return Promise.reject(new Error('Unable to create the onboarding project.'))
  }

  await deps.navigate(
    joinRouterPaths(
      PATHS.FILE,
      safeEncodeForRouterPaths(project.default_file),
      PATHS.ONBOARDING,
      onboardingStatus
    )
  )
}

export function reportOnboardingStartFailure(reason: unknown) {
  const error =
    reason instanceof Error
      ? reason
      : new Error(`Unable to start onboarding: ${String(reason)}`)
  trap(error, {
    altErr: new Error(
      'Unable to start the onboarding tutorial. Please try again.'
    ),
  })
}

/**
 * Accept to begin the onboarding tutorial,
 */
export function acceptOnboarding(deps: OnboardingUtilDeps): Promise<void> {
  // Non-path statuses should be coerced to the start path
  const onboardingStatus = !isOnboardingPath(deps.onboardingStatus)
    ? onboardingStartPath
    : deps.onboardingStatus

  if (pendingOnboardingStart) {
    return pendingOnboardingStart
  }

  const start = createOnboardingProject(deps, onboardingStatus)
  const trackedStart = start.finally(() => {
    if (pendingOnboardingStart === trackedStart) {
      pendingOnboardingStart = undefined
    }
  })
  pendingOnboardingStart = trackedStart
  return trackedStart
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

export function onDismissOnboardingInvite(settingsActor: SettingsActorType) {
  settingsActor.send({
    type: 'set.app.onboardingStatus',
    data: { level: 'user', value: 'dismissed' },
  })
  void waitForToastAnimationEnd(ONBOARDING_TOAST_ID, () => {
    toast.dismiss(ONBOARDING_TOAST_ID)
  })
  toast.success(
    'Click the question mark in the lower-right corner if you ever want to do the tutorial!',
    {
      duration: 5_000,
    }
  )
}

interface WorkflowInviteOptionCardProps {
  title: string
  description: string
  icon: CustomIconName
  dataTestId: string
  onSelect: () => void
  hoverTone?: 'primary' | 'ml-green' | 'energy-10'
  decoration?: React.ReactNode
}

function WorkflowInviteOptionCard(props: WorkflowInviteOptionCardProps) {
  const hoverToneClasses =
    props.hoverTone === 'ml-green'
      ? 'group-hover:border-ml-green dark:group-hover:text-ml-green'
      : props.hoverTone === 'energy-10'
        ? 'group-hover:border-energy-10 dark:group-hover:text-energy-10'
        : 'group-hover:border-primary dark:group-hover:text-primary'

  const hoverBgClass =
    props.hoverTone === 'ml-green'
      ? 'hover:bg-ml-green/10'
      : props.hoverTone === 'energy-10'
        ? 'hover:bg-energy-10/10'
        : 'hover:bg-primary/10'

  return (
    <button
      type="button"
      onClick={props.onSelect}
      data-testid={props.dataTestId}
      className={`group relative flex w-full min-w-[11rem] cursor-pointer hover:cursor-pointer flex-col items-center bg-transparent p-0 text-default outline-none focus-visible:ring-2 focus-visible:ring-primary border-none ${hoverBgClass}`}
    >
      <div
        className={`w-full border border-chalkboard-50 py-2 text-center text-3xl font-semibold leading-none tracking-tight transition-colors dark:border-chalkboard-80 group-hover:bg-chalkboard-20 dark:group-hover:bg-chalkboard-120 ${hoverToneClasses}`}
      >
        {props.title}
      </div>
      <span
        className={`pointer-events-none h-8 -translate-x-1/2 border-l border-chalkboard-50 transition-colors dark:border-chalkboard-80 ${hoverToneClasses}`}
      />
      {props.decoration}
      <div
        className={`flex h-28 w-full flex-col items-center justify-center gap-3 border border-chalkboard-50 px-3 py-2 text-center text-default transition-colors dark:border-chalkboard-80 group-hover:bg-chalkboard-20 dark:group-hover:bg-chalkboard-120 ${hoverToneClasses}`}
      >
        <CustomIcon name={props.icon} className="h-8 w-8 text-current" />
        <p className="m-0 text-sm leading-tight">{props.description}</p>
      </div>
    </button>
  )
}

export function TutorialRequestToast(
  props: OnboardingUtilDeps & { accountUrl: string }
) {
  const { settings } = useApp()
  function onSelectWorkflow(preference: OnboardingWorkflowPreference) {
    rememberedOnboardingWorkflowPreference = preference
    void acceptOnboarding(props)
      .then(() => toast.dismiss(ONBOARDING_TOAST_ID))
      .catch(reportOnboardingStartFailure)
  }

  return (
    <div
      data-testid="onboarding-toast"
      id={ONBOARDING_TOAST_ID}
      className="flex w-full flex-col justify-between gap-6 rounded-sm bg-chalkboard-10 p-5 text-default dark:bg-chalkboard-90"
    >
      <section className="flex items-stretch gap-4">
        <div className="relative shrink-0" style={{ minWidth: '7rem' }}>
          <img
            src={onboardingWorkflowKitt}
            alt="Kitt mascot"
            className="absolute inset-0 h-full w-full object-contain"
          />
        </div>
        <div className="flex flex-col justify-start">
          <h2 className="m-0 text-[1.9rem] font-semibold leading-tight">
            How would you like to start?
          </h2>
          <p className="mt-1 text-xl text-chalkboard-70 dark:text-chalkboard-30">
            Choose your adventure
          </p>
        </div>
      </section>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <WorkflowInviteOptionCard
          title="AI"
          description="Zookeeper, our conversational CAD agent"
          icon="sparkles"
          dataTestId="onboarding-workflow-ai"
          hoverTone="ml-green"
          onSelect={() => onSelectWorkflow('ai')}
          decoration={
            <img
              src={onboardingWorkflowAiHeadset}
              alt=""
              aria-hidden
              className="pointer-events-none absolute right-px top-[3.3rem] h-10 object-contain"
            />
          }
        />
        <WorkflowInviteOptionCard
          title="Sketch"
          description="Design using traditional point-and-click"
          icon="sketch"
          dataTestId="onboarding-workflow-sketch"
          onSelect={() => onSelectWorkflow('sketch')}
        />
        <WorkflowInviteOptionCard
          title="Code"
          description="Code-driven CAD"
          icon="code"
          dataTestId="onboarding-workflow-code"
          hoverTone="energy-10"
          onSelect={() => onSelectWorkflow('code')}
        />
      </div>
      <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[auto_1fr] sm:items-center sm:gap-5">
        <ActionButton
          Element="button"
          onClick={() => onDismissOnboardingInvite(settings.actor)}
          iconStart={{
            icon: 'close',
            className: 'text-chalkboard-10',
            bgClassName: 'bg-destroy-80 group-hover:bg-destroy-80',
          }}
          className="hover:border-destroy-40 hover:bg-destroy-10/50 dark:hover:bg-destroy-80/50"
          data-testid="onboarding-not-right-now"
        >
          Dismiss
        </ActionButton>
        <p className="m-0 text-center text-xs italic text-chalkboard-70 dark:text-chalkboard-30">
          To view your account, manage payment methods, or change tiers, simply{' '}
          <a
            href={props.accountUrl}
            onClick={openExternalBrowserIfDesktop(props.accountUrl)}
            target="_blank"
            rel="noreferrer"
            className="text-default underline underline-offset-2"
          >
            click here.
          </a>
        </p>
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
      console.error('Dropdown element not found')
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
  onMount: DefaultLayoutPaneID[] | undefined = [],
  onUnmount: DefaultLayoutPaneID[] | undefined = []
) {
  const { layout } = useApp()
  useEffect(() => {
    layout.set(
      setOpenPanes(structuredClone(layout.get() || defaultLayout), onMount)
    )

    return () =>
      layout.set(
        setOpenPanes(structuredClone(layout.get() || defaultLayout), onUnmount)
      )
  }, [onMount, onUnmount, layout])
}

export function useApplyRememberedOnboardingWorkflow(
  pathname: string,
  onboardingStatus: OnboardingStatus
) {
  const { layout } = useApp()

  useEffect(() => {
    if (!shouldApplyRememberedOnboardingWorkflow(pathname, onboardingStatus)) {
      return
    }

    const preferredOpenPanes = consumeRememberedOnboardingWorkflowPanes()
    if (!preferredOpenPanes) {
      return
    }

    // Apply after onboarding is fully closed so step unmount cleanups cannot
    // overwrite the remembered workflow layout.
    layout.set(
      setOpenPanes(
        structuredClone(layout.get() || defaultLayout),
        preferredOpenPanes
      )
    )
  }, [layout, onboardingStatus, pathname])
}

export function isModelingCmdGroupReady(
  state: SnapshotFrom<ActorRefFrom<typeof commandBarMachine>>
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
  const { commands } = useApp()
  const [isReadyOnce, setReadyOnce] = useState(false)

  // Set up a subscription to the command bar actor's
  // modeling command group
  useEffect(() => {
    const isReadyNow = isModelingCmdGroupReady(commands.actor.getSnapshot())
    if (isReadyNow) {
      setReadyOnce(true)
    } else {
      const subscription = commands.actor.subscribe((state) => {
        if (isModelingCmdGroupReady(state)) {
          setReadyOnce(true)
        }
      })
      return () => subscription.unsubscribe()
    }
  }, [commands.actor])

  // Fire the callback when the modeling command group is ready
  useEffect(() => {
    if (isReadyOnce) {
      callback()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [isReadyOnce, callback, ...deps])
}

/**
 * If your onboarding step opens the command palette it will mess with keyboard focus.
 * To side-step this, use this hook to override a form submission to advance the onboarding.
 */
export function useAdvanceOnboardingOnFormSubmit(
  currentSlug?: OnboardingPath,
  platform: undefined | keyof typeof onboardingPaths = 'desktop'
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
