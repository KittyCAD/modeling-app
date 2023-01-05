import { useStore } from '../useStore'

export function useSetCursor(sourceRange: [number, number]) {
  const setCursor = useStore((state) => state.setCursor)
  return () => {
    setCursor(sourceRange[1])
    const element: HTMLDivElement | null = document.querySelector('.cm-content')
    if (element) {
      element.focus()
    }
  }
}
