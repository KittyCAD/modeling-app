import { useHotkeys } from 'react-hotkeys-hook'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import Introduction from './Introduction'
import Camera from './Camera'
import Sketching from './Sketching'
import { useCallback } from 'react'
import makeUrlPathRelative from '../../lib/makeUrlPathRelative'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import Streaming from './Streaming'
import CodeEditor from './CodeEditor'
import ParametricModeling from './ParametricModeling'
import InteractiveNumbers from './InteractiveNumbers'
import CmdK from './CmdK'
import UserMenu from './UserMenu'
import ProjectMenu from './ProjectMenu'
import Export from './Export'
import FutureWork from './FutureWork'

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
  const {
    settings: { send },
  } = useGlobalStateContext()
  const navigate = useNavigate()
  const location = useLocation()
  const lastSlashIndex = location.pathname.lastIndexOf('/')

  return useCallback(() => {
    send({
      type: 'Set Onboarding Status',
      data: { onboardingStatus: newStatus },
    })
    navigate(location.pathname.slice(0, lastSlashIndex) + newStatus)
  }, [location, lastSlashIndex, newStatus, send, navigate])
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
      console.log('yoyo', window.location.pathname, path)
      navigate(path)
    },
    [send, navigate]
  )
}

const Onboarding = () => {
  const location = useLocation()
  const dismiss = useDismiss()
  const lastSlashIndex = location.pathname.lastIndexOf('/')
  useHotkeys('esc', () => dismiss(location.pathname.slice(0, lastSlashIndex)))

  return (
    <>
      <Outlet />
    </>
  )
}

export default Onboarding
