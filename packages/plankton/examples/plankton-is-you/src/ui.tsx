import * as Dialog from '@radix-ui/react-dialog'
import { ChevronLeft, ChevronRight, type LucideIcon, X } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'

export function IconButton({
  icon: Icon,
  label,
  ...props
}: ComponentProps<'button'> & { icon: LucideIcon; label: string }) {
  return (
    <button
      {...props}
      className={`icon-button ${props.className ?? ''}`}
      aria-label={label}
      title={label}
    >
      <Icon size={16} />
    </button>
  )
}

/** A native select parses DOM strings back into the supplied choice type. */
export function Select<const T extends string>({
  options,
  value,
  onChange,
  label,
  ...props
}: Omit<ComponentProps<'select'>, 'value' | 'onChange' | 'children'> & {
  options: readonly (readonly [T, string])[]
  value: T
  onChange(value: T): void
  label?: string
}) {
  const select = (
    <select
      {...props}
      aria-label={props['aria-label'] ?? label}
      value={value}
      onChange={(event) => {
        const choice = options.find(([key]) => key === event.target.value)
        if (choice) onChange(choice[0])
      }}
    >
      {options.map(([key, text]) => (
        <option key={key} value={key}>
          {text}
        </option>
      ))}
    </select>
  )
  return label ? (
    <label>
      {label}
      {select}
    </label>
  ) : (
    select
  )
}

/** Both edge drawers share Radix focus, dismissal, and accessible naming. */
export function Drawer({
  side,
  title,
  description,
  label,
  open,
  peek,
  onOpenChange,
  actions,
  details,
  children,
  onCloseAutoFocus,
}: {
  side: 'left' | 'right'
  title: string
  description: string
  label: string
  open: boolean
  peek: boolean
  onOpenChange(open: boolean): void
  actions?: ReactNode
  details?: ReactNode
  children: ReactNode
  onCloseAutoFocus?: ComponentProps<typeof Dialog.Content>['onCloseAutoFocus']
}) {
  const left = side === 'left'
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>
        <button
          className={`editor-edge ${left ? 'plankton-edge' : ''} ${peek ? 'peek' : ''}`}
          aria-label={label}
        >
          {left ? (
            <>
              <span>Plankton</span>
              <ChevronRight size={18} />
            </>
          ) : (
            <>
              <ChevronLeft size={18} />
              <span>Editor</span>
            </>
          )}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="editor-overlay" />
        <Dialog.Content
          className={`${left ? 'plankton-drawer' : 'editor'}${details ? ' has-selection' : ''}`}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <div className={left ? 'concepts-main' : 'editor-main'}>
            <header>
              <Dialog.Title>{title}</Dialog.Title>
              <div className="editor-actions">
                {actions ?? (
                  <Dialog.Close asChild>
                    <IconButton
                      icon={X}
                      label={
                        left ? 'Close Plankton explanation' : 'Close editor'
                      }
                    />
                  </Dialog.Close>
                )}
              </div>
            </header>
            <Dialog.Description className="editor-description">
              {description}
            </Dialog.Description>
            {children}
          </div>
          {details}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function replaceAt<T>(
  items: readonly T[],
  index: number,
  value: T
): T[] {
  return items.map((item, i) => (i === index ? value : item))
}
