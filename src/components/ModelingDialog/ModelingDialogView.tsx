import { Draggable } from '@kittycad/ui-components'
import type {
  FocusEventHandler,
  FormEventHandler,
  ReactNode,
  RefObject,
} from 'react'
import { CustomIcon } from '@src/components/CustomIcon'
import { ErrorBanner } from '@src/components/ErrorBanner'
import Tooltip from '@src/components/Tooltip'
import { CommandHelp } from '@src/components/ModelingDialog/CommandHelp'
import type { DialogField } from '@src/components/ModelingDialog/arguments'
import type { Command } from '@src/lib/commandTypes'
import { noAutofillFormProps } from '@src/lib/autofill'

/** The dialog shell is shared; hosts supply draft state, submission, and optional footer controls. */
export function ModelingDialogView({
  containerRef,
  command,
  children,
  canSubmit,
  checking = false,
  error,
  onSubmit,
  onCancel,
  onFocusCapture,
  footerAccessory,
}: {
  containerRef: RefObject<HTMLElement | null>
  command: Pick<Command, 'name' | 'icon' | 'displayName' | 'description'>
  children: ReactNode
  canSubmit: boolean
  checking?: boolean
  error?: string
  onSubmit: FormEventHandler<HTMLFormElement>
  onCancel: () => void
  onFocusCapture?: FocusEventHandler<HTMLFormElement>
  footerAccessory?: ReactNode
}) {
  return (
    <Draggable
      containerRef={containerRef}
      data-testid="modeling-dialog"
      role="region"
      aria-label={command.displayName || command.name}
      className="pointer-events-auto min-h-0 max-h-full w-80 max-w-full overflow-hidden rounded border border-chalkboard-30 bg-chalkboard-10 text-chalkboard-100 shadow-lg dark:border-chalkboard-70 dark:bg-chalkboard-100 dark:text-chalkboard-10"
      onContextMenu={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      Handle={
        <header className="flex shrink-0 cursor-move select-none items-center justify-between border-b border-chalkboard-30 px-3 py-2 dark:border-chalkboard-70">
          <span className="flex items-center gap-2 text-sm">
            {command.icon && (
              <CustomIcon name={command.icon} className="w-4 h-4" />
            )}
            {command.displayName || command.name}
          </span>
          <div className="flex items-center gap-2">
            <CommandHelp command={command} />
            <button
              type="button"
              aria-label="Cancel"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={onCancel}
              className="group m-0 rounded-sm p-0 border-none bg-transparent hover:bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-appForeground"
            >
              <CustomIcon
                name="close"
                className="w-5 h-5 rounded-sm bg-destroy-10 text-destroy-80 dark:bg-destroy-80 dark:text-destroy-10 group-hover:brightness-110"
              />
              <Tooltip position="bottom-right">
                Cancel{' '}
                <kbd className="hotkey ml-4 dark:!bg-chalkboard-80">esc</kbd>
              </Tooltip>
            </button>
          </div>
        </header>
      }
    >
      <form
        {...noAutofillFormProps}
        onSubmit={onSubmit}
        onFocusCapture={onFocusCapture}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !event.defaultPrevented) {
            event.stopPropagation()
            onCancel()
          }
        }}
        className="flex min-h-0 flex-1 flex-col text-xs"
      >
        {children}
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-chalkboard-30 p-3 dark:border-chalkboard-70">
          {error && (
            <div className="w-full">
              <ErrorBanner title="Check these arguments" message={error} />
            </div>
          )}
          {footerAccessory}
          <button
            type="submit"
            disabled={!canSubmit}
            className="m-0 ml-auto rounded-sm bg-primary px-3 py-1 text-white enabled:hover:bg-primary/90 disabled:opacity-50"
          >
            {checking ? 'Checking...' : 'Submit'}
          </button>
        </footer>
      </form>
    </Draggable>
  )
}

/** Preserve the standard field spacing, scrolling, and Advanced section in every Form host. */
export function ModelingDialogFields({
  fields,
  renderFields,
  initializing = false,
}: {
  fields: DialogField[]
  initializing?: boolean
  renderFields: (fields: DialogField[]) => ReactNode
}) {
  const advanced = fields.filter(({ arg }) => arg.dialog?.advanced)
  return (
    <div className="flex w-full min-w-0 min-h-0 flex-col gap-3 overflow-y-auto p-3">
      {initializing ? (
        <p>Loading arguments...</p>
      ) : (
        renderFields(fields.filter(({ arg }) => !arg.dialog?.advanced))
      )}
      {!initializing && advanced.length > 0 && (
        <details>
          <summary className="cursor-pointer py-1">Advanced</summary>
          <div className="flex flex-col gap-3 pt-2">
            {renderFields(advanced)}
          </div>
        </details>
      )}
    </div>
  )
}
