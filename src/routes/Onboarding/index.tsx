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
import { PATHS } from 'lib/paths'
import { useAbsoluteFilePath } from 'hooks/useAbsoluteFilePath'
import { ActionButton } from 'components/ActionButton'
import { onboardingPaths } from 'routes/Onboarding/paths'
import { codeManager, editorManager, kclManager } from 'lib/singletons'
import { bracket } from 'lib/exampleKcl'
import { toSync } from 'lib/utils'
import { reportRejection } from 'lib/trap'
import { useNetworkContext } from 'hooks/useNetworkContext'
import { NetworkHealthState } from 'hooks/useNetworkStatus'
import { EngineConnectionStateType } from 'lang/std/engineConnection'
import { CustomIcon } from 'components/CustomIcon'
import Tooltip from 'components/Tooltip'
import { commandBarActor } from 'machines/commandBarMachine'

export const kbdClasses =
  'py-0.5 px-1 text-sm rounded bg-chalkboard-10 dark:bg-chalkboard-100 border border-chalkboard-50 border-b-2'

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

export function useDemoCode() {
  const { overallState, immediateState } = useNetworkContext()

  useEffect(() => {
    // Don't run if the editor isn't loaded or the code is already the bracket
    if (!editorManager.editorView || codeManager.code === bracket) {
      return
    }
    // Don't run if the network isn't healthy or the connection isn't established
    if (
      overallState !== NetworkHealthState.Ok ||
      immediateState.type !== EngineConnectionStateType.ConnectionEstablished
    ) {
      return
    }
    setTimeout(
      toSync(async () => {
        codeManager.updateCodeStateEditor(bracket)
        await kclManager.executeCode({ zoomToFit: true })
        await codeManager.writeToFile()
      }, reportRejection)
    )
  }, [editorManager.editorView, immediateState, overallState])
}

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
    navigate(filePath + PATHS.ONBOARDING.INDEX.slice(0, -1) + newStatus)
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
    : 1
}

export function OnboardingButtons({
  currentSlug,
  className,
  dismissClassName,
  onNextOverride,
  ...props
}: {
  currentSlug?: (typeof onboardingPaths)[keyof typeof onboardingPaths]
  className?: string
  dismissClassName?: string
  onNextOverride?: () => void
} & React.HTMLAttributes<HTMLDivElement>) {
  const dismiss = useDismiss()
  const stepNumber = useStepNumber(currentSlug)
  const previousStep =
    !stepNumber || stepNumber === 0 ? null : onboardingRoutes[stepNumber - 2]
  const goToPrevious = useNextClick(
    onboardingPaths.INDEX + (previousStep?.path ?? '')
  )
  const nextStep =
    !stepNumber || stepNumber === onboardingRoutes.length
      ? null
      : onboardingRoutes[stepNumber]
  const goToNext = useNextClick(onboardingPaths.INDEX + (nextStep?.path ?? ''))

  return (
    <>
      <button
        onClick={dismiss}
        className={
          'group block !absolute left-auto right-full top-[-3px] m-2.5 p-0 border-none bg-transparent hover:bg-transparent ' +
          dismissClassName
        }
        data-testid="onboarding-dismiss"
      >
        <CustomIcon
          name="close"
          className="w-5 h-5 rounded-sm bg-destroy-10 text-destroy-80 dark:bg-destroy-80 dark:text-destroy-10 group-hover:brightness-110"
        />
        <Tooltip position="bottom" delay={500}>
          Dismiss <kbd className="hotkey ml-4 dark:!bg-chalkboard-80">esc</kbd>
        </Tooltip>
      </button>
      <div
        className={'flex items-center justify-between ' + (className ?? '')}
        {...props}
      >
        <ActionButton
          Element="button"
          onClick={() =>
            previousStep?.path || previousStep?.index
              ? goToPrevious()
              : dismiss()
          }
          iconStart={{
            icon: previousStep ? 'arrowLeft' : 'close',
            className: 'text-chalkboard-10',
            bgClassName: 'bg-destroy-80 group-hover:bg-destroy-80',
          }}
          className="hover:border-destroy-40 hover:bg-destroy-10/50 dark:hover:bg-destroy-80/50"
          data-testid="onboarding-prev"
        >
          {previousStep ? `Back` : 'Dismiss'}
        </ActionButton>
        {stepNumber !== undefined && (
          <p className="font-mono text-xs text-center m-0">
            {stepNumber} / {onboardingRoutes.length}
          </p>
        )}
        <ActionButton
          autoFocus
          Element="button"
          onClick={() => {
            if (nextStep?.path) {
              onNextOverride ? onNextOverride() : goToNext()
            } else {
              dismiss()
            }
          }}
          iconStart={{
            icon: nextStep ? 'arrowRight' : 'checkmark',
            bgClassName: 'dark:bg-chalkboard-80',
          }}
          className="dark:hover:bg-chalkboard-80/50"
          data-testid="onboarding-next"
        >
          {nextStep ? `Next` : 'Finish'}
        </ActionButton>
      </div>
    </>
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
