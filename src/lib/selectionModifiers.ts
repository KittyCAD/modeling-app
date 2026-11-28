import type { KclManager } from '@src/lang/KclManager'

/** Legacy selection actions read this manager's Shift state when engine pick responses arrive. */
export function trackSelectionModifiers(
  manager: Pick<KclManager, 'setIsShiftDown'>
) {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Shift') manager.setIsShiftDown(true)
  }
  const handleKeyUp = (event: KeyboardEvent) => {
    if (event.key === 'Shift') manager.setIsShiftDown(false)
  }
  const reset = () => manager.setIsShiftDown(false)
  const handleVisibilityChange = () => {
    if (document.hidden) reset()
  }
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
  window.addEventListener('blur', reset)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  return () => {
    window.removeEventListener('keydown', handleKeyDown)
    window.removeEventListener('keyup', handleKeyUp)
    window.removeEventListener('blur', reset)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    reset()
  }
}
