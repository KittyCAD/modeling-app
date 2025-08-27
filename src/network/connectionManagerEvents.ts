import { EngineDebugger } from '@src/lib/debugger'
import { EngineCommandManagerEvents } from './utils'
import type RustContext from '@src/lib/rustContext'

export const createOnEngineConnectionRestartRequest = ({
  dispatchEvent,
}: {
  dispatchEvent: (event: Event) => boolean
}) => {
  const onEngineConnectionRestartRequest = () => {
    dispatchEvent(
      new CustomEvent(EngineCommandManagerEvents.EngineRestartRequest)
    )
  }
  return onEngineConnectionRestartRequest
}

export const createOnEngineOffline = ({
  dispatchEvent,
}: { dispatchEvent: (event: Event) => boolean }) => {
  const onEngineOffline = () => {
    dispatchEvent(new CustomEvent(EngineCommandManagerEvents.Offline))
  }
  return onEngineOffline
}

export const createOnEngineConnectionOpened = () => {
  const onEngineConnectionOpened = async () => {
    try {
      EngineDebugger.addLog({
        label: 'onEngineConnectionOpened',
        message: 'clearing scene and busting cache',
      })
    } catch (e) {}
  }
  return onEngineConnectionOpened
}

export const onEngineConnectionStarted = () => {
  const onEngineConnectionStarted = () => {}
  return onEngineConnectionStarted
}
