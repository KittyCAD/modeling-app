import { useHotkeys } from 'react-hotkeys-hook'
import { Outlet, useNavigate } from 'react-router-dom'
import Introduction from './Introduction'
import Camera from './Camera'
import Sketching from './Sketching'
import { useCallback } from 'react'
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
import { paths } from 'Router'
import { useAbsoluteFilePath } from 'hooks/useAbsoluteFilePath'
import { ActionButton } from 'components/ActionButton'

export const ONBOARDING_PROJECT_NAME = 'Tutorial Project $nn'

export const onboardingPaths = {
  INDEX: '/',
  CAMERA: '/camera',
  STREAMING: '/streaming',
  EDITOR: '/editor',
  PARAMETRIC_MODELING: '/parametric-modeling',
  INTERACTIVE_NUMBERS: '/interactive-numbers',
  COMMAND_K: '/command-k',
  USER_MENU: '/user-menu',
  PROJECT_MENU: '/project-menu',
  EXPORT: '/export',
  MOVE: '/move',
  SKETCHING: '/sketching',
  FUTURE_WORK: '/future-work',
}

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
      type: 'Set Onboarding Status',
      data: { onboardingStatus: newStatus },
    })
    navigate(filePath + paths.ONBOARDING.INDEX.slice(0, -1) + newStatus)
  }, [filePath, newStatus, send, navigate])
}

export function useDismiss() {
  const filePath = useAbsoluteFilePath()
  const {
    settings: { send },
  } = useSettingsAuthContext()
  const navigate = useNavigate()

  return useCallback(() => {
    send({
      type: 'Set Onboarding Status',
      data: { onboardingStatus: 'dismissed' },
    })
    navigate(filePath)
  }, [send, navigate, filePath])
}

export function OnboardingButtons({
  next,
  nextText,
  dismiss,
  className,
  ...props
}: {
  next: () => void
  nextText?: string
  dismiss: () => void
  className?: string
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={'flex justify-between ' + (className ?? '')} {...props}>
      <ActionButton
        Element="button"
        onClick={dismiss}
        icon={{
          icon: 'close',
          bgClassName: 'bg-destroy-80',
          iconClassName: 'text-destroy-20 group-hover:text-destroy-10',
        }}
        className="hover:border-destroy-40 hover:bg-destroy-10/50 dark:hover:bg-destroy-80/50"
      >
        Dismiss
      </ActionButton>
      <ActionButton
        Element="button"
        onClick={next}
        icon={{ icon: 'arrowRight', bgClassName: 'dark:bg-chalkboard-80' }}
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
