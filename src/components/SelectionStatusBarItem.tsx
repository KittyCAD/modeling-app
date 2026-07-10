import { CustomIcon } from '@src/components/CustomIcon'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'
import Tooltip from '@src/components/Tooltip'
import { LazyRegistryComponent } from '@src/registry/lazyComponent'
import type { RegistryComponentLoader } from '@src/registry/lazyComponent'
import type { ComponentType } from 'react'
import { useState } from 'react'

type EagerPopoverSection = {
  id: string
  component: ComponentType
}

type LazyPopoverSection = {
  id: string
  loadComponent: RegistryComponentLoader<object>
}

type PopoverSection = EagerPopoverSection | LazyPopoverSection

export function SelectionStatusBarItem({
  label,
  popoverSections,
}: {
  label: string
  popoverSections: PopoverSection[]
}) {
  const [isOpen, setIsOpen] = useState(false)
  const hasPopover = popoverSections.length > 0

  if (!hasPopover) {
    return (
      <div
        role="tooltip"
        className={defaultStatusBarItemClassNames}
        data-testid="selection-status"
      >
        <span>{label}</span>
        <Tooltip position="top-right">Currently selected geometry</Tooltip>
      </div>
    )
  }

  return (
    <div className="relative">
      <button
        type="button"
        className={`${defaultStatusBarItemClassNames} max-w-[40vw] gap-1`}
        data-testid="selection-status"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(true)}
      >
        <span className="truncate">{label}</span>
        {!isOpen && (
          <Tooltip wrapperClassName="ui-open:hidden" position="top-right">
            Currently selected geometry
          </Tooltip>
        )}
      </button>
      {isOpen && (
        <div
          className="absolute right-0 bottom-full mb-1 z-20 w-[min(240px,calc(100vw-1rem))] max-h-[60vh] overflow-auto rounded-md border border-chalkboard-30 bg-chalkboard-10 shadow-lg dark:border-chalkboard-80 dark:bg-chalkboard-100"
          data-testid="selection-references-popover"
        >
          <div className="sticky top-0 z-10 flex justify-end border-b border-chalkboard-30 dark:border-chalkboard-80 bg-chalkboard-10 dark:bg-chalkboard-100 p-1">
            <button
              type="button"
              className="flex items-center gap-1 rounded-sm px-2 py-1 text-xs text-chalkboard-80 hover:bg-chalkboard-20 focus:bg-chalkboard-20 focus:outline-none dark:text-chalkboard-20 dark:hover:bg-chalkboard-90 dark:focus:bg-chalkboard-90"
              onClick={() => setIsOpen(false)}
            >
              <CustomIcon name="close" className="h-3.5 w-3.5" />
              Close
            </button>
          </div>
          {popoverSections.map((section) => {
            if ('loadComponent' in section) {
              return (
                <LazyRegistryComponent
                  key={section.id}
                  loadComponent={section.loadComponent}
                  fallback={null}
                />
              )
            }

            const Section = section.component
            return <Section key={section.id} />
          })}
        </div>
      )}
    </div>
  )
}
