import { useHotkeys } from 'react-hotkeys-hook'
import { Outlet, useNavigate } from 'react-router-dom'
import Introduction from './Introduction'
import Units from './Units'
import Camera from './Camera'
import Sketching from './Sketching'
import { useCallback } from 'react'
import makeUrlPathRelative from '../../lib/makeUrlPathRelative'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'

export const onboardingPaths = {
  INDEX: '/',
  UNITS: '/units',
  CAMERA: '/camera',
  SKETCHING: '/sketching',
}

export const onboardingRoutes = [
  {
    index: true,
    element: <Introduction />,
  },
  {
    path: makeUrlPathRelative(onboardingPaths.UNITS),
    element: <Units />,
  },
  {
    path: makeUrlPathRelative(onboardingPaths.CAMERA),
    element: <Camera />,
  },
  // Streaming
  // Code editor / KCL
  // Parametric modeling
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
    navigate((newStatus !== onboardingPaths.UNITS ? '..' : '.') + newStatus)
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
