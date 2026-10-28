import { useCallback, useEffect, useRef } from 'react'
import type { KeyboardEventHandler } from 'react'
import { ActionButton } from '@src/components/ActionButton'
import { noAutofillInputProps } from '@src/lib/autofill'
import type { FiltersConfig } from '@src/lib/commandTypes'
import { reportRejection } from '@src/lib/trap'

export function CommandPathInput({
  id,
  value,
  filters,
  required,
  autoFocus,
  autoOpen = false,
  inline = true,
  onChange,
  onKeyDown,
}: {
  id: string
  value: string | File | undefined
  filters: FiltersConfig
  required: boolean
  autoFocus?: boolean
  autoOpen?: boolean
  inline?: boolean
  onChange: (value: string | File) => void
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pickFile = useCallback(async () => {
    if (!window.electron) {
      fileInputRef.current?.click()
      return
    }
    // Desktop e2e tests seed the path instead of opening the native picker.
    const testValue = inputRef.current?.dataset.testValue
    if (testValue) {
      onChange(testValue)
      return
    }
    const result = await window.electron.open({
      properties: ['openFile'],
      title: 'Pick a file to load into the current project',
      filters,
    })
    if (!result.canceled && result.filePaths[0]) onChange(result.filePaths[0])
  }, [filters, onChange])

  useEffect(() => {
    if (autoOpen && window.electron?.process.env.NODE_ENV !== 'test')
      void pickFile().catch(reportRejection)
  }, [autoOpen, pickFile])

  const extensions = filters.flatMap((filter) => filter.extensions)
  return (
    <div
      className={`flex min-w-0 flex-1 items-center ${inline ? '' : 'rounded-sm border border-chalkboard-30 dark:border-chalkboard-70'}`}
    >
      <input
        {...noAutofillInputProps}
        type="text"
        data-testid="cmd-bar-arg-value"
        id={id}
        name="path"
        ref={inputRef}
        required={required}
        autoFocus={autoFocus}
        className="min-w-0 flex-1 border-0 px-2 py-1 !bg-transparent focus:outline-none"
        placeholder="Choose a file"
        readOnly={!window.electron}
        value={typeof value === 'string' ? value : value?.name || ''}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {!window.electron && (
        <input
          ref={fileInputRef}
          type="file"
          aria-label="Choose a file"
          accept={
            extensions.includes('*')
              ? undefined
              : extensions.map((extension) => `.${extension}`).join(',')
          }
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file) onChange(file)
            event.currentTarget.value = ''
          }}
        />
      )}
      <ActionButton
        Element="button"
        type="button"
        aria-label="Open file"
        onClick={() => {
          void pickFile().catch(reportRejection)
        }}
        className="p-0 m-0 border-none hover:bg-primary/10 focus:bg-primary/10 dark:hover:bg-primary/20 dark:focus::bg-primary/20"
        data-testid="cmd-bar-arg-file-button"
        iconEnd={{ icon: 'file', size: 'sm', className: 'p-1' }}
      >
        Open file
      </ActionButton>
    </div>
  )
}
