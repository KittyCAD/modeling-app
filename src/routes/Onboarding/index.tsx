import { useHotkeys } from 'react-hotkeys-hook'
import { Outlet, useNavigate } from 'react-router-dom'
import { useStore } from '../../useStore'
import { App } from '../../App'

import Introduction from './Introduction'
import Units from './Units'
import Camera from './Camera'

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
]

const Onboarding = () => {
    const {
        setOnboardingStatus,
    } = useStore((s) => ({
        setOnboardingStatus: s.setOnboardingStatus,
    }))

    const navigate = useNavigate()
    useHotkeys('esc', () => {
        setOnboardingStatus('dismissed')
        navigate('/')
    })

    return <>
        <Outlet />
        <App />
    </>
}

export default Onboarding