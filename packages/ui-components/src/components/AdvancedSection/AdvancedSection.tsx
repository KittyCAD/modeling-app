import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

export type AdvancedSectionProps = {
  title?: ReactNode
  description?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}

function CaretIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={`h-4 w-4 transition-transform ${isOpen ? '' : '-rotate-90'}`}
    >
      <path
        d="M5.5 7.5L10 12L14.5 7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
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
      className="border-chalkboard-20 border-t pt-1 dark:border-chalkboard-80"
    >
      <summary className="-mx-1 flex min-h-7 cursor-pointer list-none items-center justify-between gap-2 rounded-sm px-1 py-1 text-xs font-medium leading-tight text-chalkboard-70 hover:bg-chalkboard-20/50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-appForeground dark:text-chalkboard-30 dark:hover:bg-chalkboard-90 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 truncate">{title}</span>
        <span
          className="shrink-0 text-chalkboard-50 dark:text-chalkboard-50"
          aria-hidden
        >
          <CaretIcon isOpen={isOpen} />
        </span>
      </summary>
      {description && (
        <p className="my-0 pb-2 text-[11px] leading-tight text-chalkboard-60 dark:text-chalkboard-40">
          {description}
        </p>
      )}
      <div className="flex flex-col gap-2.5 py-1">{children}</div>
    </details>
  )
}
