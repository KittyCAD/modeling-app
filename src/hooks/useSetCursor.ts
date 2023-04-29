import { useStore, Selection } from '../useStore'

export function useSetCursor(id: string, type: Selection['type'] = 'default') {
  const { engineCommandManager } = useStore((s) => ({
    engineCommandManager: s.engineCommandManager,
  }))
  return () => {
    engineCommandManager.click(id, type)
  }
}
