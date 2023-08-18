import { useHotkeys } from 'react-hotkeys-hook'
import { Outlet, useNavigate } from 'react-router-dom'
import { useStore } from '../../useStore'

import Introduction from './Introduction'
import Units from './Units'
import Camera from './Camera'
import Sketching from './Sketching'
import { useCallback } from 'react'
import { paths } from '../../Router'
import makeUrlPathRelative from '../../lib/makeUrlPathRelative'

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
  {
    path: makeUrlPathRelative(onboardingPaths.SKETCHING),
    element: <Sketching />,
  },
]

export function useNextClick(newStatus: string) {
  const { setOnboardingStatus } = useStore((s) => ({
    setOnboardingStatus: s.setOnboardingStatus,
  }))
  const navigate = useNavigate()

  return useCallback(() => {
    setOnboardingStatus(newStatus)
    navigate((newStatus !== onboardingPaths.UNITS ? '..' : '.') + newStatus)
  }, [newStatus, setOnboardingStatus, navigate])
}

export function useDismiss() {
  const { setOnboardingStatus } = useStore((s) => ({
    setOnboardingStatus: s.setOnboardingStatus,
  }))
  const navigate = useNavigate()

  return useCallback(
    (path: string) => {
      setOnboardingStatus('dismissed')
      navigate(path)
    },
    [setOnboardingStatus, navigate]
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
