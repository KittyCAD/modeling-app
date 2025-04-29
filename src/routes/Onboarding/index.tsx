import { useHotkeys } from 'react-hotkeys-hook'
import { Outlet } from 'react-router-dom'

import makeUrlPathRelative from '@src/lib/makeUrlPathRelative'
import Camera from '@src/routes/Onboarding/Camera'
import CmdK from '@src/routes/Onboarding/CmdK'
import CodeEditor from '@src/routes/Onboarding/CodeEditor'
import Export from '@src/routes/Onboarding/Export'
import FutureWork from '@src/routes/Onboarding/FutureWork'
import InteractiveNumbers from '@src/routes/Onboarding/InteractiveNumbers'
import Introduction from '@src/routes/Onboarding/Introduction'
import ParametricModeling from '@src/routes/Onboarding/ParametricModeling'
import ProjectMenu from '@src/routes/Onboarding/ProjectMenu'
import Sketching from '@src/routes/Onboarding/Sketching'
import Streaming from '@src/routes/Onboarding/Streaming'
import UserMenu from '@src/routes/Onboarding/UserMenu'
import { useDismiss } from '@src/routes/Onboarding/utils'
import { ONBOARDING_SUBPATHS } from '@src/lib/paths'

export const onboardingRoutes = [
  {
    index: true,
    element: <Introduction />,
  },
  {
    path: makeUrlPathRelative(ONBOARDING_SUBPATHS.CAMERA),
    element: <Camera />,
  },
  {
    path: makeUrlPathRelative(ONBOARDING_SUBPATHS.STREAMING),
    element: <Streaming />,
  },
  {
    path: makeUrlPathRelative(ONBOARDING_SUBPATHS.EDITOR),
    element: <CodeEditor />,
  },
  {
    path: makeUrlPathRelative(ONBOARDING_SUBPATHS.PARAMETRIC_MODELING),
    element: <ParametricModeling />,
  },
  {
    path: makeUrlPathRelative(ONBOARDING_SUBPATHS.INTERACTIVE_NUMBERS),
    element: <InteractiveNumbers />,
  },
  {
    path: makeUrlPathRelative(ONBOARDING_SUBPATHS.COMMAND_K),
    element: <CmdK />,
  },
  {
    path: makeUrlPathRelative(ONBOARDING_SUBPATHS.USER_MENU),
    element: <UserMenu />,
  },
  {
    path: makeUrlPathRelative(ONBOARDING_SUBPATHS.PROJECT_MENU),
    element: <ProjectMenu />,
  },
  {
    path: makeUrlPathRelative(ONBOARDING_SUBPATHS.EXPORT),
    element: <Export />,
  },
  // Export / conversion API
  {
    path: makeUrlPathRelative(ONBOARDING_SUBPATHS.SKETCHING),
    element: <Sketching />,
  },
  {
    path: makeUrlPathRelative(ONBOARDING_SUBPATHS.FUTURE_WORK),
    element: <FutureWork />,
  },
]

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
