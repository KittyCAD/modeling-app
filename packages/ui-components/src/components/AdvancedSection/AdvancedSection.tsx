import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

export type AdvancedSectionProps = {
  title?: ReactNode
  description?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}

export function AdvancedSection({
  title = 'Advanced',
  description,
  defaultOpen = false,
  children,
}: AdvancedSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  useEffect(() => {
    if (defaultOpen) {
      setIsOpen(true)
    }
  }, [defaultOpen])

  return (
    <details
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      className="border-t border-chalkboard-20 pt-1 dark:border-chalkboard-70"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-1 text-[11px] font-semibold uppercase leading-tight text-chalkboard-70 outline-current dark:text-chalkboard-30">
        <span>{title}</span>
        <span className="text-xs leading-none" aria-hidden>
          {isOpen ? '-' : '+'}
        </span>
      </summary>
      {description && (
        <p className="my-0 pb-2 text-[10px] leading-tight text-chalkboard-60 dark:text-chalkboard-40">
          {description}
        </p>
      )}
      <div className="flex flex-col gap-2.5 py-1">{children}</div>
    </details>
  )
}
