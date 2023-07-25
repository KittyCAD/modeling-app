import { useHotkeys } from 'react-hotkeys-hook'
import { Outlet, useNavigate } from 'react-router-dom'
import { useStore } from '../../useStore'
import { App } from '../../App'

import Introduction from './Introduction'
import Units from './Units'
import Camera from './Camera'
import Sketching from './Sketching'
import { useCallback } from 'react'

export const onboardingRoutes = [
  {
    path: '',
    element: <Introduction />,
  },
  {
    path: 'units',
    element: <Units />,
  },
  {
    path: 'camera',
    element: <Camera />,
  },
  {
    path: 'sketching',
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
    navigate('/onboarding/' + newStatus)
  }, [newStatus, setOnboardingStatus, navigate])
}

export function useDismiss() {
  const { setOnboardingStatus } = useStore((s) => ({
    setOnboardingStatus: s.setOnboardingStatus,
  }))
  const navigate = useNavigate()

  return useCallback(() => {
    setOnboardingStatus('dismissed')
    navigate('/')
  }, [setOnboardingStatus, navigate])
}

const Onboarding = () => {
  const dismiss = useDismiss()
  useHotkeys('esc', dismiss)

  return (
    <>
      <Outlet />
      <App />
    </>
  )
}

export default Onboarding
