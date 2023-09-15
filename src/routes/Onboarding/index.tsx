import { useHotkeys } from 'react-hotkeys-hook'
import { Outlet, useNavigate } from 'react-router-dom'
import Introduction from './Introduction'
import Camera from './Camera'
import Sketching from './Sketching'
import { useCallback } from 'react'
import makeUrlPathRelative from '../../lib/makeUrlPathRelative'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import Streaming from './Streaming'
import CodeEditor from './CodeEditor'
import ParametricModeling from './ParametricModeling'

export const onboardingPaths = {
  INDEX: '/',
  CAMERA: '/camera',
  STREAMING: '/streaming',
  EDITOR: '/editor',
  PARAMETRIC_MODELING: '/parametric-modeling',
  INTERACTIVE_NUMBERS: '/interactive-numbers',
  AUTOCOMPLETE: '/autocomplete',
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
  // Interactive numbers
  // Autocomplete / LSP
  // Command + K
  // User menu
  // Project menu
  // Export / conversion API
  {
    path: makeUrlPathRelative(onboardingPaths.SKETCHING),
    element: <Sketching />,
  },
  // Move
  // Future Work
]

export function useNextClick(newStatus: string) {
  const {
    settings: { send },
  } = useGlobalStateContext()
  const navigate = useNavigate()

  return useCallback(() => {
    send({
      type: 'Set Onboarding Status',
      data: { onboardingStatus: newStatus },
    })
    navigate((newStatus !== onboardingPaths.CAMERA ? '..' : '.') + newStatus)
  }, [newStatus, send, navigate])
}

export function useDismiss() {
  const {
    settings: { send },
  } = useGlobalStateContext()
  const navigate = useNavigate()

  return useCallback(
    (path: string) => {
      send({
        type: 'Set Onboarding Status',
        data: { onboardingStatus: 'dismissed' },
      })
      navigate(path)
    },
    [send, navigate]
  )
}

const Onboarding = () => {
  const dismiss = useDismiss()
  useHotkeys('esc', () => dismiss('../'))

  return (
    <>
      <Outlet />
    </>
  )
}

export default Onboarding
