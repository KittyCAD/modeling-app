import { useHotkeys } from 'react-hotkeys-hook'
import { Outlet, useNavigate } from 'react-router-dom'
import Introduction from './Introduction'
import Camera from './Camera'
import Sketching from './Sketching'
import { useCallback, useEffect } from 'react'
import makeUrlPathRelative from '../../lib/makeUrlPathRelative'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import Streaming from './Streaming'
import CodeEditor from './CodeEditor'
import ParametricModeling from './ParametricModeling'
import InteractiveNumbers from './InteractiveNumbers'
import CmdK from './CmdK'
import UserMenu from './UserMenu'
import ProjectMenu from './ProjectMenu'
import Export from './Export'
import FutureWork from './FutureWork'
import { paths } from 'lib/paths'
import { useAbsoluteFilePath } from 'hooks/useAbsoluteFilePath'
import { ActionButton } from 'components/ActionButton'
import { onboardingPaths } from 'routes/Onboarding/paths'

export const kbdClasses =
  'p-0.5 text-sm rounded-sm bg-chalkboard-10 dark:bg-chalkboard-100 border border-chalkboard-50'

export const onboardingRoutes = [
  {
    index: true,
    element: <Introduction />,
  },
  {
    path: makeUrlPathRelative(onboardingPaths.CAMERA),
    element: <Camera />,
  },
  {
    path: makeUrlPathRelative(onboardingPaths.STREAMING),
    element: <Streaming />,
  },
  {
    path: makeUrlPathRelative(onboardingPaths.EDITOR),
    element: <CodeEditor />,
  },
  {
    path: makeUrlPathRelative(onboardingPaths.PARAMETRIC_MODELING),
    element: <ParametricModeling />,
  },
  {
    path: makeUrlPathRelative(onboardingPaths.INTERACTIVE_NUMBERS),
    element: <InteractiveNumbers />,
  },
  {
    path: makeUrlPathRelative(onboardingPaths.COMMAND_K),
    element: <CmdK />,
  },
  {
    path: makeUrlPathRelative(onboardingPaths.USER_MENU),
    element: <UserMenu />,
  },
  {
    path: makeUrlPathRelative(onboardingPaths.PROJECT_MENU),
    element: <ProjectMenu />,
  },
  {
    path: makeUrlPathRelative(onboardingPaths.EXPORT),
    element: <Export />,
  },
  // Export / conversion API
  {
    path: makeUrlPathRelative(onboardingPaths.SKETCHING),
    element: <Sketching />,
  },
  {
    path: makeUrlPathRelative(onboardingPaths.FUTURE_WORK),
    element: <FutureWork />,
  },
]

export function useNextClick(newStatus: string) {
  const filePath = useAbsoluteFilePath()
  const {
    settings: { send },
  } = useSettingsAuthContext()
  const navigate = useNavigate()

  return useCallback(() => {
    send({
      type: 'set.app.onboardingStatus',
      data: { level: 'user', value: newStatus },
    })
    navigate(filePath + paths.ONBOARDING.INDEX.slice(0, -1) + newStatus)
  }, [filePath, newStatus, send, navigate])
}

export function useDismiss() {
  const filePath = useAbsoluteFilePath()
  const {
    settings: { state, send },
  } = useSettingsAuthContext()
  const navigate = useNavigate()

  const settingsCallback = useCallback(() => {
    send({
      type: 'set.app.onboardingStatus',
      data: { level: 'user', value: 'dismissed' },
    })
  }, [send])

  /**
   * A "listener" for the XState to return to "idle" state
   * when the user dismisses the onboarding, using the callback above
   */
  useEffect(() => {
    if (
      state.context.app.onboardingStatus.user === 'dismissed' &&
      state.matches('idle')
    ) {
      navigate(filePath)
    }
  }, [filePath, navigate, state])

  return settingsCallback
}

// Get the 1-indexed step number of the current onboarding step
export function useStepNumber(
  slug?: (typeof onboardingPaths)[keyof typeof onboardingPaths]
) {
  return slug
    ? slug === onboardingPaths.INDEX
      ? 1
      : onboardingRoutes.findIndex(
          (r) => r.path === makeUrlPathRelative(slug)
        ) + 1
    : undefined
}

export function OnboardingButtons({
  next,
  nextText,
  dismiss,
  currentSlug,
  className,
  ...props
}: {
  next: () => void
  nextText?: string
  dismiss: () => void
  currentSlug?: (typeof onboardingPaths)[keyof typeof onboardingPaths]
  className?: string
} & React.HTMLAttributes<HTMLDivElement>) {
  const stepNumber = useStepNumber(currentSlug)

  return (
    <div
      className={'flex items-center justify-between ' + (className ?? '')}
      {...props}
    >
      <ActionButton
        Element="button"
        onClick={dismiss}
        iconStart={{
          icon: 'close',
          bgClassName: 'bg-destroy-80 group-hover:bg-destroy-80',
          iconClassName: 'text-destroy-20 group-hover:text-destroy-10',
        }}
        className="hover:border-destroy-40 hover:bg-destroy-10/50 dark:hover:bg-destroy-80/50"
      >
        Dismiss
      </ActionButton>
      {stepNumber !== undefined && (
        <p className="font-mono text-xs text-center m-0">
          {stepNumber} / {onboardingRoutes.length}
        </p>
      )}
      <ActionButton
        Element="button"
        onClick={next}
        iconStart={{ icon: 'arrowRight', bgClassName: 'dark:bg-chalkboard-80' }}
        className="dark:hover:bg-chalkboard-80/50"
        data-testid="onboarding-next"
      >
        {nextText ?? 'Next'}
      </ActionButton>
    </div>
  )
}

const Onboarding = () => {
  const dismiss = useDismiss()
  useHotkeys('esc', dismiss)

  return (
    <div className="content" data-testid="onboarding-content">
      <Outlet />
    </div>
  )
}

export default Onboarding
