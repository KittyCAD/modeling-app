import { useStore } from '../useStore'
import { useEffect } from 'react'

export function useHotKeyListener() {
  const { setIsShiftDown } = useStore((s) => ({
    setIsShiftDown: s.setIsShiftDown,
  }))
  const keyName = 'CapsLock' // TODO should be shift, but shift conflicts with the editor's use of the shift key atm.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) =>
      event.key === keyName && setIsShiftDown(true)
    const handleKeyUp = (event: KeyboardEvent) =>
      event.key === keyName && setIsShiftDown(false)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [setIsShiftDown])
}
