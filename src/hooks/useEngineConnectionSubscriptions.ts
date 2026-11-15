import { useEffect, useRef } from 'react'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { bindEngineConnectionSubscriptions } from '@src/lib/scene/modelingMachineSubscriptions'
export { selectSketchPlane } from '@src/lib/selectSketchPlane'

export function useEngineConnectionSubscriptions() {
  const { send, context, state } = useModelingContext()
  const stateRef = useRef(state)
  stateRef.current = state
  useEffect(
    () =>
      bindEngineConnectionSubscriptions({
        context,
        send,
        getState: () => stateRef.current,
      }),
    // Rebind only when an input owner changes; selection changes are read through getState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      context.sketchEnginePathId,
      context.kclManager,
      context.rustContext,
      context.engineCommandManager,
      context.wasmInstance,
      send,
    ]
  )
}
