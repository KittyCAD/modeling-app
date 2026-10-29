import { Menu, Portal } from '@headlessui/react'
import type { PropsWithChildren } from 'react'
import { useId, useRef } from 'react'

import { ActionIcon } from '@src/components/ActionIcon'

export const HeaderMenu = ({ children }: PropsWithChildren) => {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const anchorName = `--panel-header-menu-${id}`
  const buttonRef = useRef<HTMLButtonElement>(null)
  const itemsRef = useRef<HTMLDivElement>(null)

  return (
    <Menu>
      <div className="relative">
        <Menu.Button
          ref={buttonRef}
          className="!p-0 !bg-transparent hover:text-primary border-transparent dark:!border-transparent hover:!border-primary dark:hover:!border-chalkboard-70 ui-open:!border-primary dark:ui-open:!border-chalkboard-70 !outline-none"
          onClick={(e) => e.stopPropagation()}
          style={{ anchorName }}
        >
          <ActionIcon
            icon="three-dots"
            className="p-1"
            size="sm"
            bgClassName="bg-transparent dark:bg-transparent"
            iconClassName={'!text-chalkboard-90 dark:!text-chalkboard-40'}
          />
        </Menu.Button>
        <Portal>
          <Menu.Items
            ref={itemsRef}
            popover="manual"
            className="fixed z-50 m-0 w-72 max-w-[calc(100vw-1rem)] max-h-[calc(100vh-1rem)] overflow-y-auto flex flex-col gap-1 divide-y divide-chalkboard-20 dark:divide-chalkboard-70 align-stretch px-0 py-1 bg-chalkboard-10 dark:bg-chalkboard-100 rounded-sm shadow-lg border border-solid border-chalkboard-20/50 dark:border-chalkboard-80/50"
            style={{
              positionAnchor: anchorName,
              right: `anchor(${anchorName} right)`,
              top: `anchor(${anchorName} bottom)`,
              left: 'auto',
              bottom: 'auto',
              marginTop: 4,
              positionTry: 'flip-block, flip-inline, flip-block flip-inline',
              positionTryFallbacks:
                'flip-block, flip-inline, flip-block flip-inline',
            }}
          >
            {children}
          </Menu.Items>
        </Portal>
      </div>
    </Menu>
  )
}
