import { Menu, Portal } from '@headlessui/react'
import { CustomIcon } from '@src/components/CustomIcon'
import type { PropsWithChildren } from 'react'
import { createContext, useContext, useId } from 'react'
import { cleanPaneHeaderButtonClassName } from './headerStyles'

export type PaneContentSelectorOption = {
  id: string
  label: string
}

type PaneContentSelectorContextValue = {
  currentId: string
  onSelect: (id: string) => void
  options: readonly PaneContentSelectorOption[]
}

const PaneContentSelectorContext =
  createContext<PaneContentSelectorContextValue | null>(null)

export function PaneContentSelectorProvider({
  children,
  currentId,
  onSelect,
  options,
}: PropsWithChildren<PaneContentSelectorContextValue>) {
  return (
    <PaneContentSelectorContext.Provider
      value={{ currentId, onSelect, options }}
    >
      {children}
    </PaneContentSelectorContext.Provider>
  )
}

export function PaneContentSelector() {
  const selector = useContext(PaneContentSelectorContext)
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  if (!selector) {
    return null
  }

  const anchorName = `--pane-content-selector-${id}`
  return (
    <Menu>
      <Menu.Button
        aria-label="Change pane content"
        className={`${cleanPaneHeaderButtonClassName} !h-6 !w-6`}
        data-testid="pane-content-selector-button"
        style={{ anchorName }}
        title="Change pane content"
      >
        <CustomIcon className="h-3 w-3 ui-open:rotate-180" name="caretDown" />
      </Menu.Button>
      <Portal>
        <Menu.Items
          className="fixed z-50 m-0 flex w-56 max-w-[calc(100vw-1rem)] flex-col gap-0.5 rounded-lg border border-solid border-chalkboard-30 bg-chalkboard-10 p-1 text-inherit shadow-xl outline-none dark:border-chalkboard-80 dark:bg-chalkboard-100 dark:text-chalkboard-10"
          data-testid="pane-content-selector-menu"
          popover="manual"
          style={{
            positionAnchor: anchorName,
            left: `anchor(${anchorName} left)`,
            top: `anchor(${anchorName} bottom)`,
            marginTop: 4,
            positionTry: 'flip-block, flip-inline, flip-block flip-inline',
            positionTryFallbacks:
              'flip-block, flip-inline, flip-block flip-inline',
          }}
        >
          {selector.options.map((option) => (
            <Menu.Item key={option.id}>
              {({ active }) => (
                <button
                  className={`m-0 flex w-full items-center gap-2 rounded-md border-0 px-2.5 py-2 text-left text-sm shadow-none ${
                    active
                      ? 'bg-chalkboard-20 dark:bg-chalkboard-90'
                      : 'bg-transparent'
                  }`}
                  data-testid={`pane-content-option-${option.id}`}
                  onClick={() => selector.onSelect(option.id)}
                  type="button"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {option.label}
                  </span>
                  {selector.currentId === option.id ? (
                    <CustomIcon
                      className="h-4 w-4 flex-none"
                      name="checkmark"
                    />
                  ) : null}
                </button>
              )}
            </Menu.Item>
          ))}
        </Menu.Items>
      </Portal>
    </Menu>
  )
}
