import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { HistoryService } from '@src/lib/history'
import { HistoryStackNames, Stack } from '@src/lib/history'

export function useHistory(instance: HistoryService) {
  const history = useMemo(() => instance, [instance])
  return useSyncExternalStore(history.subscribe, history.getSnapshot)
}
export function useStack(instance?: Stack) {
  const stack = useMemo(() => instance ?? new Stack(), [instance])
  return useSyncExternalStore(stack.subscribe, stack.getSnapshot)
}

export function useHistoryStackWhileFocused(
  targetElement: Element | undefined,
  history: HistoryService,
  stack: HistoryStackNames
) {
  useEffect(() => {
    const inCallback = () => {
      console.log('focusin', targetElement)
      history.currentStackId = stack
    }
    const outCallback = () => {
      console.log('focusout', targetElement)
      history.currentStackId = HistoryStackNames.Editor
    }
    targetElement?.addEventListener('focusin', inCallback)
    targetElement?.addEventListener('focusout', outCallback)

    return () => {
      targetElement?.removeEventListener('focusin', inCallback)
      targetElement?.removeEventListener('focusout', outCallback)
    }
  }, [history, stack, targetElement])
}
