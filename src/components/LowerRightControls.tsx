import type { NavigateFunction } from 'react-router-dom'

export function LowerRightControls({
  children,
}: {
  children?: React.ReactNode
  navigate?: NavigateFunction
}) {
  return (
    <section className="absolute bottom-2 right-2 flex flex-col items-end gap-3 pointer-events-none">
      {children}
    </section>
  )
}
