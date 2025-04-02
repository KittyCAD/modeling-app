import { useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { waitFor } from 'xstate'

import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { useAbsoluteFilePath } from '@src/hooks/useAbsoluteFilePath'
import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import { EngineConnectionStateType } from '@src/lang/std/engineConnection'
import { bracket } from '@src/lib/exampleKcl'
import makeUrlPathRelative from '@src/lib/makeUrlPathRelative'
import { PATHS } from '@src/lib/paths'
import { codeManager, editorManager, kclManager } from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import { toSync } from '@src/lib/utils'
import { settingsActor } from '@src/machines/appMachine'
import { onboardingPaths } from '@src/routes/Onboarding/paths'
import { onboardingRoutes } from '.'

export const kbdClasses =
  'py-0.5 px-1 text-sm rounded bg-chalkboard-10 dark:bg-chalkboard-100 border border-chalkboard-50 border-b-2'

// Get the 1-indexed step number of the current onboarding step
function useStepNumber(
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
        await kclManager.executeCode(true)
        await codeManager.writeToFile()
      }, reportRejection)
    )
  }, [editorManager.editorView, immediateState, overallState])
}

export function useNextClick(newStatus: string) {
  const filePath = useAbsoluteFilePath()
  const navigate = useNavigate()

  return useCallback(() => {
    settingsActor.send({
      type: 'set.app.onboardingStatus',
      data: { level: 'user', value: newStatus },
    })
    navigate(filePath + PATHS.ONBOARDING.INDEX.slice(0, -1) + newStatus)
  }, [filePath, newStatus, settingsActor.send, navigate])
}

export function useDismiss() {
  const filePath = useAbsoluteFilePath()
  const send = settingsActor.send
  const navigate = useNavigate()

  const settingsCallback = useCallback(() => {
    send({
      type: 'set.app.onboardingStatus',
      data: { level: 'user', value: 'dismissed' },
    })
    waitFor(settingsActor, (state) => state.matches('idle'))
      .then(() => navigate(filePath))
      .catch(reportRejection)
  }, [send])

  return settingsCallback
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
        <Tooltip position="bottom">
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
