import { useModelingContext } from '@src/hooks/useModelingContext'
import { useApp, useSingletons } from '@src/lib/boot'
import { EngineDebugger } from '@src/lib/debugger'
import { useEffect, useRef } from 'react'

export const useOnPageIdle = ({
  startCallback,
  idleCallback,
}: {
  startCallback: () => void
  idleCallback: () => void
}) => {
  const { settings } = useApp()
  const { kclManager } = useSingletons()
  const settingsValues = settings.useSettings()
  const streamIdleMode = settingsValues.app.streamIdleMode.current
  const { state: modelingMachineState } = useModelingContext()
  const intervalId = useRef<NodeJS.Timeout | null>(null)
  const startCallbackRef = useRef(startCallback)
  const idleCallbackRef = useRef(idleCallback)
  const modelingMachineStateRef = useRef(modelingMachineState)
  const idleTimeMsRef = useRef(Number(streamIdleMode))
  const wasBusyRef = useRef(false)
  const timeoutStart = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (intervalId.current) {
        clearInterval(intervalId.current)
        intervalId.current = null
      }
    }
  }, [])

  useEffect(() => {
    startCallbackRef.current = startCallback
  }, [startCallback])

  useEffect(() => {
    idleCallbackRef.current = idleCallback
  }, [idleCallback])

  useEffect(() => {
    modelingMachineStateRef.current = modelingMachineState
  }, [modelingMachineState])

  useEffect(() => {
    idleTimeMsRef.current = Number(streamIdleMode)
    timeoutStart.current = idleTimeMsRef.current ? Date.now() : null
  }, [streamIdleMode])

  useEffect(() => {
    if (intervalId.current) {
      return
    }

    // Check every 1 second to see if you are idle.
    const interval = setInterval(() => {
      void (async () => {
        const idleTimeMs = idleTimeMsRef.current
        if (!idleTimeMs) {
          timeoutStart.current = null
          wasBusyRef.current = false
          return
        }

        const isBusy =
          kclManager.isExecuting ||
          !modelingMachineStateRef.current.matches('idle')

        // Only start the idle timer once KCL execution and other modeling
        // interactions have fully finished.
        if (isBusy) {
          timeoutStart.current = null
          wasBusyRef.current = true
          return
        }

        if (wasBusyRef.current) {
          timeoutStart.current = Date.now()
          wasBusyRef.current = false
          return
        }

        if (timeoutStart.current) {
          const elapsed = Date.now() - timeoutStart.current
          if (elapsed >= idleTimeMs) {
            timeoutStart.current = null
            try {
              await kclManager.sceneInfra.camControls.saveRemoteCameraState()
            } catch (e) {
              console.warn('unable to save old camera state on idle', e)
              kclManager.sceneInfra.camControls.clearOldCameraState()
            }
            console.log(kclManager.sceneInfra.camControls.oldCameraState)
            console.warn('detected idle, tearing down connection.')
            EngineDebugger.addLog({
              label: 'useOnPageIdle',
              message: 'Calling tearDown()',
            })
            // We do a full tear down at the moment.
            kclManager.engineCommandManager.tearDown()
            idleCallbackRef.current()
          }
        }
      })()
    }, 1_000)
    intervalId.current = interval
  }, [kclManager])

  useEffect(() => {
    if (!idleTimeMsRef.current) return

    const onAnyInput = () => {
      // Just in case it happens in the middle of the user turning off
      // idle mode.
      if (!idleTimeMsRef.current) {
        timeoutStart.current = null
        return
      }
      startCallbackRef.current()
      timeoutStart.current =
        kclManager.isExecuting ||
        !modelingMachineStateRef.current.matches('idle')
          ? null
          : Date.now()
    }

    // It's possible after a reconnect, the user doesn't move their mouse at
    // all, meaning the timer is not reset to run. We need to set it every
    // time our effect dependencies change then.
    timeoutStart.current =
      kclManager.isExecuting || !modelingMachineStateRef.current.matches('idle')
        ? null
        : Date.now()

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
  }, [kclManager, streamIdleMode])
}
