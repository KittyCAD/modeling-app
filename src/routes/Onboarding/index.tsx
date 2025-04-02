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
import { onboardingPaths } from '@src/routes/Onboarding/paths'
import { useDismiss } from '@src/routes/Onboarding/utils'

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
    : 1
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
