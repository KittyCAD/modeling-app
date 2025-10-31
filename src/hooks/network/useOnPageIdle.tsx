import { KclManagerEvents } from '@src/lang/KclSingleton'
import {
  engineCommandManager,
  kclManager,
  sceneInfra,
  useSettings,
} from '@src/lib/singletons'
import { useEffect, useRef, useState } from 'react'
import { useModelingContext } from '@src/hooks/useModelingContext'

export const useOnPageIdle = ({
  startCallback,
  idleCallback,
}: {
  startCallback: () => void
  idleCallback: () => void
}) => {
  const settings = useSettings()
  const intervalId = useRef<NodeJS.Timeout | null>(null)
  const [streamIdleMode, setStreamIdleMode] = useState(
    settings.app.streamIdleMode.current
  )
  const { state: modelingMachineState } = useModelingContext()
  const IDLE_TIME_MS = Number(5000)
  // When streamIdleMode is changed, setup or teardown the timeouts
  const timeoutStart = useRef<number | null>(null)

  useEffect(() => {
    // When execution takes a long time, it's most likely a user will want to
    // come back and be able to say, export the model. The issue with this is
    // that means the application should NOT go into idle mode for a long time!
    // We've picked 8 hours to coincide with the typical length of a workday.
    const onLongExecution = () => {
      setStreamIdleMode(1000 * 60 * 60 * 8)
    }

    kclManager.addEventListener(KclManagerEvents.LongExecution, onLongExecution)

    return () => {
      kclManager.removeEventListener(
        KclManagerEvents.LongExecution,
        onLongExecution
      )
    }
  }, [])

  useEffect(() => {
    timeoutStart.current = streamIdleMode ? Date.now() : null
  }, [streamIdleMode])

  useEffect(() => {
    if (intervalId.current) {
      // we have a loop running don't clear it!
      return
    }

    // Check every 1 second to see if you are idle.
    const interval = setInterval(() => {
      void (async () => {
        // Do not pause if the user is in the middle of an operation
        if (!modelingMachineState.matches('idle')) {
          // In fact, stop the timeout, because we don't want to trigger the
          // pause when we exit the operation.
          timeoutStart.current = null
        } else if (timeoutStart.current) {
          const elapsed = Date.now() - timeoutStart.current
          // Don't pause if we're already disconnected.
          if (
            // It's unnecessary to once again setup an event listener for
            // offline/online to capture this state, when this state already
            // exists on the window.navigator object. In hindsight it makes
            // me (lee) regret we set React state variables such as
            // isInternetConnected in other files when we could check this
            // object instead.
            elapsed >= IDLE_TIME_MS
          ) {
            timeoutStart.current = null
            try {
              await sceneInfra.camControls.saveRemoteCameraState()
            } catch (e) {
              console.warn('unable to save old camera state on idle')
              sceneInfra.camControls.clearOldCameraState()
            }
            console.log(sceneInfra.camControls.oldCameraState)
            console.warn('detected idle, tearing down connection.')
            // We do a full tear down at the moment.
            engineCommandManager.tearDown()
            idleCallback()
          }
        }
      })()
    }, 1_000)
    intervalId.current = interval
  }, [IDLE_TIME_MS, idleCallback, modelingMachineState])

  useEffect(() => {
    if (!streamIdleMode) return

    const onAnyInput = () => {
      // Just in case it happens in the middle of the user turning off
      // idle mode.
      if (!streamIdleMode) {
        timeoutStart.current = null
        return
      }
      startCallback()
      timeoutStart.current = Date.now()
    }

    // It's possible after a reconnect, the user doesn't move their mouse at
    // all, meaning the timer is not reset to run. We need to set it every
    // time our effect dependencies change then.
    timeoutStart.current = Date.now()

    window.document.addEventListener('keydown', onAnyInput)
    window.document.addEventListener('keyup', onAnyInput)
    window.document.addEventListener('mousemove', onAnyInput)
    window.document.addEventListener('mousedown', onAnyInput)
    window.document.addEventListener('mouseup', onAnyInput)
    window.document.addEventListener('scroll', onAnyInput)
    window.document.addEventListener('touchstart', onAnyInput)
    window.document.addEventListener('touchend', onAnyInput)

    return () => {
      timeoutStart.current = null
      window.document.removeEventListener('keydown', onAnyInput)
      window.document.removeEventListener('keyup', onAnyInput)
      window.document.removeEventListener('mousemove', onAnyInput)
      window.document.removeEventListener('mousedown', onAnyInput)
      window.document.removeEventListener('mouseup', onAnyInput)
      window.document.removeEventListener('scroll', onAnyInput)
      window.document.removeEventListener('touchstart', onAnyInput)
      window.document.removeEventListener('touchend', onAnyInput)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [streamIdleMode])
}
