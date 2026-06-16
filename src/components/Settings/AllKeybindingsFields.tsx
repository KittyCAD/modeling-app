import { Combobox } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import Fuse from 'fuse.js'
import {
  type ForwardedRef,
  forwardRef,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useLocation } from 'react-router-dom'

import { CustomIcon } from '@src/components/CustomIcon'
import {
  type KeybindingRow,
  createRowUserBinding,
  findKeybindingConflict,
  formatKeybindingConflict,
  getKeybindingRows,
  normalizeVisibleKeymapScopes,
  serializeKeymapScopes,
} from '@src/components/Settings/keybindingRows'
import Tooltip from '@src/components/Tooltip'
import { useApp } from '@src/lib/boot'
import type { Command } from '@src/lib/commandTypes'
import { reportRejection } from '@src/lib/trap'
import { platform } from '@src/lib/utils'
import { commandKey, commandsValueSpec } from '@src/registry/contracts/commands'
import {
  BASE_KEYMAP_SCOPE,
  CODE_EDITOR_FOCUSED_KEYMAP_SCOPE,
  KEYMAP_SCHEMA_VERSION,
  type KeymapArguments,
  type KeymapBinding,
  type KeymapItem,
  type KeymapScope,
  type KeymapService,
  USER_KEYMAP_SOURCE,
  createUnbindBinding,
  getKeymapItemScopes,
  keymapBindingCanCollideWithTyping,
  keymapScopesValueSpec,
  keymapService,
  keymapValueSpec,
  normalizeEventKey,
} from '@src/registry/contracts/keymap'

type AllKeybindingsFieldsProps = object

type SearchOption = {
  id: string
  title: string
  description?: string
}

const keymapModifierDisplay: Record<string, string> = {
  alt: 'Alt',
  cmd: 'Command',
  command: 'Command',
  control: 'Control',
  ctrl: 'Control',
  meta: 'Meta',
  mod: platform() === 'macos' ? 'Command' : 'Control',
  option: 'Option',
  shift: 'Shift',
}

const iconButtonClassName =
  'relative inline-flex h-6 w-6 items-center justify-center rounded border border-transparent bg-transparent p-0 text-chalkboard-70 transition-opacity hover:border-chalkboard-30 hover:bg-chalkboard-20 dark:text-chalkboard-30 dark:hover:border-chalkboard-70 dark:hover:bg-chalkboard-80'

export const AllKeybindingsFields = forwardRef(
  (
    _props: AllKeybindingsFieldsProps,
    scrollRef: ForwardedRef<HTMLDivElement>
  ) => {
    useSignals()
    const { registry } = useApp()
    const location = useLocation()
    const keymap = registry.optional(keymapService)
    const contributedKeymap = registry.signal(keymapValueSpec).value
    const commands = registry.signal(commandsValueSpec).value
    const keymapScopes = registry.signal(keymapScopesValueSpec).value
    const persistedKeymap = keymap?.persistedKeymap.value ?? {
      version: KEYMAP_SCHEMA_VERSION,
      bindings: [],
    }
    const commandOptions = useMemo(
      () => createCommandSearchOptions(commands, contributedKeymap.items),
      [commands, contributedKeymap.items]
    )
    const scopeOptions = useMemo(
      () => createScopeSearchOptions(keymapScopes),
      [keymapScopes]
    )
    const rows = getKeybindingRows(
      contributedKeymap.items,
      persistedKeymap.bindings
    )
    const [isAdding, setIsAdding] = useState(false)

    const saveBindings = (bindings: readonly KeymapBinding[]) => {
      keymap
        ?.savePersistedKeymap({
          ...persistedKeymap,
          bindings,
        })
        .catch(reportRejection)
    }

    return (
      <div className="relative overflow-y-auto pb-16">
        <div ref={scrollRef} className="flex flex-col gap-3 px-2 pr-4">
          <div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="px-2 py-1 text-sm flex gap-1 pl-0.5 pr-2"
                onClick={() => setIsAdding(true)}
              >
                <CustomIcon className="w-5 h-5" name="plus" />
                Add keybinding
              </button>
              <button
                type="button"
                className="px-2 py-1 text-sm flex gap-1 pl-0.5 pr-2 disabled:pointer-events-none disabled:opacity-40"
                disabled={persistedKeymap.bindings.length === 0}
                onClick={() => saveBindings([])}
              >
                <CustomIcon className="w-5 h-5" name="refresh" />
                Reset all
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-chalkboard-10 dark:bg-chalkboard-100">
                <tr className="border-0 border-b border-solid border-chalkboard-30 text-xs uppercase text-chalkboard-60 dark:border-chalkboard-80 dark:text-chalkboard-50">
                  <th className="px-2 py-2 font-medium">Title</th>
                  <th className="px-2 py-2 font-medium">Keystrokes</th>
                  <th className="px-2 py-2 font-medium">Arguments</th>
                  <th className="px-2 py-2 font-medium">Scopes</th>
                  <th className="px-2 py-2 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {isAdding && (
                  <NewKeybindingRow
                    keymap={keymap}
                    rows={rows}
                    commandOptions={commandOptions}
                    scopeOptions={scopeOptions}
                    onCancel={() => setIsAdding(false)}
                    onSave={(binding) => {
                      saveBindings([...persistedKeymap.bindings, binding])
                      setIsAdding(false)
                    }}
                  />
                )}
                {rows.map((row) => (
                  <KeybindingTableRow
                    key={row.id}
                    row={row}
                    rows={rows}
                    keymap={keymap}
                    scopeOptions={scopeOptions}
                    isHighlighted={location.hash === `#${row.id}`}
                    onSaveBinding={(binding, index) => {
                      if (index === undefined) {
                        saveBindings([...persistedKeymap.bindings, binding])
                        return
                      }

                      saveBindings(
                        persistedKeymap.bindings.map((existing, i) =>
                          i === index ? binding : existing
                        )
                      )
                    }}
                    onRemoveBinding={(index) => {
                      saveBindings(
                        persistedKeymap.bindings.filter(
                          (_binding, i) => i !== index
                        )
                      )
                    }}
                    onAppendBinding={(binding) => {
                      saveBindings([...persistedKeymap.bindings, binding])
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }
)

function KeybindingTableRow({
  row,
  rows,
  keymap,
  scopeOptions,
  isHighlighted,
  onSaveBinding,
  onRemoveBinding,
  onAppendBinding,
}: {
  row: KeybindingRow
  rows: readonly KeybindingRow[]
  keymap: KeymapService | undefined
  scopeOptions: readonly SearchOption[]
  isHighlighted: boolean
  onSaveBinding: (binding: KeymapBinding, index?: number) => void
  onRemoveBinding: (index: number) => void
  onAppendBinding: (binding: KeymapBinding) => void
}) {
  const [draftKeystrokes, setDraftKeystrokes] = useState<
    readonly string[] | null
  >(null)
  const isEditing = draftKeystrokes !== null
  const visibleKeystrokes = draftKeystrokes ?? row.keystrokes
  const isUnbound = row.state === 'unbound'
  const visibleBinding = {
    command: row.command,
    keystrokes: visibleKeystrokes,
    scopes: row.scopes,
  }
  const conflict = findKeybindingConflict(rows, {
    id: row.id,
    keystrokes: visibleKeystrokes,
    scopes: row.scopes,
  })
  const showsTypingCollisionWarning =
    !isUnbound && keymapBindingCanCollideWithTyping(visibleBinding)

  const saveDraftKeystrokes = () => {
    if (!draftKeystrokes || draftKeystrokes.length === 0) {
      return
    }

    const binding = createRowUserBinding(row, draftKeystrokes, row.scopes)
    onSaveBinding(binding, row.userBindingIndex)
    setDraftKeystrokes(null)
  }

  const saveScopes = (scopes: readonly string[]) => {
    onSaveBinding(
      createRowUserBinding(row, row.keystrokes, scopes),
      row.userBindingIndex
    )
  }

  const deleteOrUnbind = () => {
    if (row.state === 'user' && row.userBindingIndex !== undefined) {
      onRemoveBinding(row.userBindingIndex)
      return
    }

    if (
      row.state === 'override' &&
      row.appItem &&
      row.userBindingIndex !== undefined
    ) {
      onSaveBinding(createUnbindBinding(row.appItem), row.userBindingIndex)
      return
    }

    if (row.state === 'app' && row.appItem) {
      onAppendBinding(createUnbindBinding(row.appItem))
    }
  }

  const restore = () => {
    if (row.userBindingIndex !== undefined) {
      onRemoveBinding(row.userBindingIndex)
    }
  }

  return (
    <tr
      id={row.id}
      className={
        'group border-0 border-b border-solid border-chalkboard-20 align-top dark:border-chalkboard-90 ' +
        (isHighlighted ? 'bg-primary/5 dark:bg-chalkboard-90' : '')
      }
    >
      <td className="px-2 py-3">
        <div className="flex min-w-48 items-center gap-2">
          <h3 className="m-0 text-base font-normal capitalize tracking-wide">
            {row.title}
          </h3>
          {row.state === 'override' && <StateChip>User override</StateChip>}
          {isUnbound && <StateChip>Unbound</StateChip>}
        </div>
        <code className="block text-xs font-mono text-2">{row.command}</code>
      </td>
      <td className="px-2 py-3">
        {isUnbound ? (
          <span className="text-sm text-chalkboard-50">-</span>
        ) : (
          <div className="flex min-w-44 flex-wrap items-center">
            <KeystrokesField
              keymap={keymap}
              value={visibleKeystrokes}
              isListening={isEditing}
              onStartListening={() => setDraftKeystrokes([])}
              onChange={setDraftKeystrokes}
            />
            {isEditing && (
              <>
                <IconButton
                  label="Save keybinding"
                  icon="checkmark"
                  alwaysVisible
                  disabled={!draftKeystrokes || draftKeystrokes.length === 0}
                  onClick={saveDraftKeystrokes}
                />
                <IconButton
                  label="Cancel keybinding edit"
                  icon="close"
                  alwaysVisible
                  onClick={() => setDraftKeystrokes(null)}
                />
              </>
            )}
            {conflict && (
              <WarningChip>{formatKeybindingConflict(conflict)}</WarningChip>
            )}
          </div>
        )}
      </td>
      <td className="max-w-64 break-all px-2 py-3 font-mono text-xs">
        {formatArguments(row.arguments)}
      </td>
      <td className="px-2 py-3">
        <ScopesField
          value={getKeymapItemScopes(row)}
          options={scopeOptions}
          readOnly={isUnbound}
          hasTypingCollision={showsTypingCollisionWarning}
          onChange={saveScopes}
        />
      </td>
      <td className="px-2 py-3">
        <div className="flex min-w-36 items-center justify-between gap-2">
          <span className="text-sm">{row.source}</span>
          <div className="flex items-center gap-1">
            {(row.state === 'override' || row.state === 'unbound') && (
              <IconButton
                label="Restore default keybinding"
                icon="refresh"
                onClick={restore}
              />
            )}
            {row.state !== 'unbound' && (
              <IconButton
                label={
                  row.state === 'user'
                    ? 'Delete user keybinding'
                    : 'Unbind keybinding'
                }
                icon="trash"
                onClick={deleteOrUnbind}
              />
            )}
          </div>
        </div>
      </td>
    </tr>
  )
}

function NewKeybindingRow({
  keymap,
  rows,
  commandOptions,
  scopeOptions,
  onCancel,
  onSave,
}: {
  keymap: KeymapService | undefined
  rows: readonly KeybindingRow[]
  commandOptions: readonly SearchOption[]
  scopeOptions: readonly SearchOption[]
  onCancel: () => void
  onSave: (binding: KeymapBinding) => void
}) {
  const [command, setCommand] = useState('')
  const [title, setTitle] = useState('')
  const [keystrokes, setKeystrokes] = useState<readonly string[]>([])
  const [argumentsText, setArgumentsText] = useState('')
  const [scopes, setScopes] = useState<readonly string[]>([BASE_KEYMAP_SCOPE])
  const [isListening, setIsListening] = useState(false)
  const [error, setError] = useState<{
    field: 'command' | 'keystrokes' | 'arguments'
    message: string
  } | null>(null)
  const conflict = findKeybindingConflict(rows, { keystrokes, scopes })
  const showsTypingCollisionWarning = keymapBindingCanCollideWithTyping({
    command,
    keystrokes,
    scopes,
  })

  const save = () => {
    setError(null)
    if (!command.trim()) {
      setError({ field: 'command', message: 'Action is required.' })
      return
    }
    if (keystrokes.length === 0) {
      setError({ field: 'keystrokes', message: 'Keystrokes are required.' })
      return
    }

    const parsedArguments = parseArgumentsInput(argumentsText)
    if (parsedArguments instanceof Error) {
      setError({ field: 'arguments', message: parsedArguments.message })
      return
    }

    onSave({
      command: command.trim(),
      title: title.trim() || undefined,
      keystrokes,
      arguments: parsedArguments,
      scopes: serializeKeymapScopes(scopes),
    })
  }

  return (
    <tr className="border-0 border-b border-solid border-primary/40 align-top bg-primary/5 dark:bg-primary/10">
      <td className="px-2 py-3">
        <input
          className="w-48 bg-transparent text-base block"
          value={title}
          placeholder="Title"
          onChange={(event) => setTitle(event.target.value)}
        />
        <SearchableTextField
          className="w-64 font-mono text-xs"
          value={command}
          placeholder="command.id"
          options={commandOptions}
          hasError={error?.field === 'command'}
          onChange={setCommand}
        />
        {error?.field === 'command' && (
          <p className="m-0 mt-1 text-xs text-destroy-80">{error.message}</p>
        )}
      </td>
      <td className="px-2 py-3">
        <KeystrokesField
          keymap={keymap}
          value={keystrokes}
          isListening={isListening}
          onStartListening={() => {
            setKeystrokes([])
            setIsListening(true)
          }}
          onStopListening={() => setIsListening(false)}
          onChange={setKeystrokes}
        />
        {error?.field === 'keystrokes' && (
          <p className="m-0 mt-1 text-xs text-destroy-80">{error.message}</p>
        )}
        {conflict && (
          <WarningChip>{formatKeybindingConflict(conflict)}</WarningChip>
        )}
      </td>
      <td className="px-2 py-3">
        <textarea
          className="min-h-8 w-48 resize-y bg-transparent font-mono text-xs"
          value={argumentsText}
          placeholder='{"tab":"project"}'
          onChange={(event) => setArgumentsText(event.target.value)}
        />
        {error?.field === 'arguments' && (
          <p className="m-0 mt-1 text-xs text-destroy-80">{error.message}</p>
        )}
      </td>
      <td className="px-2 py-3">
        <ScopesField
          value={scopes}
          options={scopeOptions}
          hasTypingCollision={showsTypingCollisionWarning}
          onChange={setScopes}
        />
      </td>
      <td className="px-2 py-3">
        <div className="flex min-w-28 items-center justify-between gap-2">
          <span className="text-sm">{USER_KEYMAP_SOURCE}</span>
          <div className="flex gap-1">
            <IconButton
              label="Save keybinding"
              icon="checkmark"
              alwaysVisible
              onClick={save}
            />
            <IconButton
              label="Cancel new keybinding"
              icon="close"
              alwaysVisible
              onClick={onCancel}
            />
          </div>
        </div>
      </td>
    </tr>
  )
}

function parseArgumentsInput(
  value: string
): KeymapArguments | undefined | Error {
  if (!value.trim()) {
    return undefined
  }

  try {
    return JSON.parse(value) as KeymapArguments
  } catch {
    return new Error('Arguments must be valid JSON.')
  }
}

function SearchableTextField({
  value,
  placeholder,
  options,
  className,
  hasError = false,
  onChange,
}: {
  value: string
  placeholder: string
  options: readonly SearchOption[]
  className?: string
  hasError?: boolean
  onChange: (value: string) => void
}) {
  const [query, setQuery] = useState('')
  const fuse = useMemo(
    () =>
      new Fuse(options, {
        keys: ['id', 'title', 'description'],
        includeScore: true,
      }),
    [options]
  )
  const filteredOptions = query.trim()
    ? fuse.search(query).map((result) => result.item)
    : options.slice(0, 8)

  return (
    <Combobox
      value={value}
      onChange={(nextValue: string) => {
        onChange(nextValue)
        setQuery('')
      }}
    >
      <div className="relative">
        <Combobox.Input
          className={`${className ?? ''} bg-transparent ${
            hasError
              ? 'rounded border border-destroy-50 px-1 dark:border-destroy-60'
              : ''
          }`}
          displayValue={(selectedValue: string) => selectedValue}
          placeholder={placeholder}
          onChange={(event) => {
            setQuery(event.target.value)
            onChange(event.target.value)
          }}
        />
        {filteredOptions.length > 0 && (
          <Combobox.Options className="absolute left-0 top-full z-50 mt-1 max-h-64 min-w-full overflow-y-auto rounded border border-chalkboard-30 bg-chalkboard-10 shadow-sm dark:border-chalkboard-70 dark:bg-chalkboard-100">
            {filteredOptions.map((option) => (
              <Combobox.Option
                key={option.id}
                value={option.id}
                className="flex cursor-pointer flex-col gap-1 px-2 py-1.5 ui-active:bg-primary/10 dark:ui-active:bg-chalkboard-90"
              >
                <span className="text-xs font-medium">{option.title}</span>
                <span className="font-mono text-[11px] text-chalkboard-60 dark:text-chalkboard-50">
                  {option.id}
                </span>
                {option.description && (
                  <span className="line-clamp-2 text-[11px] text-chalkboard-60 dark:text-chalkboard-50">
                    {option.description}
                  </span>
                )}
              </Combobox.Option>
            ))}
          </Combobox.Options>
        )}
      </div>
    </Combobox>
  )
}

function createCommandSearchOptions(
  commands: readonly Command[],
  keymapItems: readonly KeymapItem[]
): SearchOption[] {
  const commandOptions = commands.map((command) => {
    const id = commandKey(command)
    return {
      id,
      title: command.displayName ?? String(command.name),
      description: command.description ?? command.groupId,
    }
  })
  const keymapCommandOptions = keymapItems
    .filter((item) => !item.hidden)
    .map((item) => ({
      id: item.command,
      title: item.title,
      description: item.command,
    }))

  return dedupeSearchOptions([...commandOptions, ...keymapCommandOptions])
}

function createScopeSearchOptions(scopes: readonly KeymapScope[]) {
  return dedupeSearchOptions(
    scopes
      .filter((scope) => scope.id !== BASE_KEYMAP_SCOPE)
      .map((scope) => ({
        id: scope.id,
        title: scope.displayName,
      }))
  )
}

function dedupeSearchOptions(options: readonly SearchOption[]) {
  return [
    ...new Map(options.map((option) => [option.id, option])).values(),
  ].toSorted((a, b) => a.title.localeCompare(b.title))
}

function ScopesField({
  value,
  options,
  readOnly = false,
  hasTypingCollision = false,
  onChange,
}: {
  value: readonly string[]
  options: readonly SearchOption[]
  readOnly?: boolean
  hasTypingCollision?: boolean
  onChange: (value: readonly string[]) => void
}) {
  const [query, setQuery] = useState('')
  const fuse = useMemo(
    () =>
      new Fuse(options, {
        keys: ['id', 'title', 'description'],
        includeScore: true,
      }),
    [options]
  )
  const scopes = normalizeVisibleKeymapScopes(value)
  const filteredOptions = (
    query.trim() ? fuse.search(query).map((result) => result.item) : options
  )
    .filter((option) => !scopes.includes(option.id))
    .slice(0, 8)

  const addScope = (scope: string) => {
    const nextScope = scope.trim()
    if (!nextScope || scopes.includes(nextScope)) {
      setQuery('')
      return
    }

    onChange(
      scopes.length === 1 && scopes[0] === BASE_KEYMAP_SCOPE
        ? [nextScope]
        : [...scopes, nextScope]
    )
    setQuery('')
  }

  return (
    <div className="flex min-w-48 flex-wrap items-center gap-1.5">
      {scopes.map((scope) => {
        const isTypingCollision =
          hasTypingCollision &&
          (scope === BASE_KEYMAP_SCOPE ||
            scope === CODE_EDITOR_FOCUSED_KEYMAP_SCOPE)
        const chipClassName = isTypingCollision
          ? 'inline-flex items-center gap-1 rounded border border-destroy-50 bg-destroy-10 px-1.5 py-0.5 text-xs text-destroy-80 dark:border-destroy-60 dark:bg-destroy-80/20 dark:text-destroy-30'
          : 'inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary dark:bg-primary/20'
        const removeButtonClassName = isTypingCollision
          ? 'm-0 border-0 bg-transparent p-0 text-destroy-80 dark:text-destroy-30'
          : 'm-0 border-0 bg-transparent p-0 text-primary'

        return (
          <span key={scope} className={`relative ${chipClassName}`}>
            {formatScopeLabel(scope, options)}
            {!readOnly && scope !== BASE_KEYMAP_SCOPE && (
              <button
                type="button"
                className={removeButtonClassName}
                aria-label={`Remove ${scope} scope`}
                onClick={() =>
                  onChange(scopes.filter((existing) => existing !== scope))
                }
              >
                <CustomIcon name="close" className="h-3 w-3" />
              </button>
            )}
            {isTypingCollision && (
              <Tooltip position="top-right">
                Keystrokes will interfere with typing in code editor. Use the
                code-editor-not-focused scope to run this only outside the
                editor.
              </Tooltip>
            )}
          </span>
        )
      })}
      {!readOnly && (
        <Combobox value="" onChange={addScope}>
          <div className="relative">
            <Combobox.Input
              className="w-28 bg-transparent text-xs"
              displayValue={() => query}
              placeholder="Add scope"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addScope(query)
                }
              }}
            />
            {filteredOptions.length > 0 && (
              <Combobox.Options className="absolute left-0 top-full z-50 mt-1 max-h-64 min-w-44 overflow-y-auto rounded border border-chalkboard-30 bg-chalkboard-10 shadow-sm dark:border-chalkboard-70 dark:bg-chalkboard-100">
                {filteredOptions.map((option) => (
                  <Combobox.Option
                    key={option.id}
                    value={option.id}
                    className="flex cursor-pointer flex-col gap-1 px-2 py-1.5 ui-active:bg-primary/10 dark:ui-active:bg-chalkboard-90"
                  >
                    <span className="text-xs font-medium">{option.title}</span>
                    <span className="font-mono text-[11px] text-chalkboard-60 dark:text-chalkboard-50">
                      {option.id}
                    </span>
                  </Combobox.Option>
                ))}
              </Combobox.Options>
            )}
          </div>
        </Combobox>
      )}
    </div>
  )
}

function KeystrokesField({
  keymap,
  value,
  isListening,
  onStartListening,
  onStopListening,
  onChange,
}: {
  keymap: KeymapService | undefined
  value: readonly string[]
  isListening: boolean
  onStartListening: () => void
  onStopListening?: () => void
  onChange: (value: readonly string[]) => void
}) {
  useEffect(() => {
    if (!isListening) {
      return
    }

    const resumeListening = keymap?.suspendListening()
    const handleKeyDown = (event: KeyboardEvent) => {
      const chord = keyboardEventToKeymapChord(event)
      if (!chord) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      onChange([...value, chord])
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
      resumeListening?.()
    }
  }, [isListening, keymap, onChange, value])

  return (
    <button
      type="button"
      className="flex min-h-8 min-w-36 flex-wrap items-center gap-2 border-chalkboard-30 px-2 py-1 text-left dark:border-chalkboard-70"
      onClick={onStartListening}
      onBlur={onStopListening}
    >
      {value.length > 0 ? (
        value.map((chord, index) => (
          <kbd key={`${chord}-${index}`} className="hotkey text-base">
            {formatKeymapChord(chord)}
          </kbd>
        ))
      ) : (
        <span className="text-xs text-chalkboard-60 dark:text-chalkboard-50">
          {isListening ? 'Press keys...' : 'Click to record'}
        </span>
      )}
    </button>
  )
}

function StateChip({ children }: React.PropsWithChildren) {
  return (
    <span className="rounded border border-chalkboard-30 px-1.5 py-0.5 text-xs text-chalkboard-60 dark:border-chalkboard-70 dark:text-chalkboard-40">
      {children}
    </span>
  )
}

function WarningChip({ children }: React.PropsWithChildren) {
  return (
    <span className="mt-1 rounded border border-destroy-50 bg-destroy-10 px-1.5 py-0.5 text-xs text-destroy-80 dark:border-destroy-60 dark:bg-destroy-80/20 dark:text-destroy-30">
      {children}
    </span>
  )
}

function formatScopeLabel(scope: string, options: readonly SearchOption[]) {
  if (scope === BASE_KEYMAP_SCOPE) {
    return 'Base'
  }

  return options.find((option) => option.id === scope)?.title ?? scope
}

function IconButton({
  label,
  icon,
  alwaysVisible = false,
  disabled,
  onClick,
}: {
  label: string
  icon: 'checkmark' | 'close' | 'refresh' | 'trash'
  alwaysVisible?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  const visibilityClassName = alwaysVisible
    ? 'opacity-100'
    : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
  return (
    <button
      type="button"
      aria-label={label}
      className={`${iconButtonClassName} ${visibilityClassName} disabled:pointer-events-none disabled:opacity-30`}
      disabled={disabled}
      onClick={onClick}
    >
      <CustomIcon name={icon} className="h-4 w-4" />
      <Tooltip position="top-right">{label}</Tooltip>
    </button>
  )
}

function formatArguments(args: KeymapArguments | undefined) {
  if (args === undefined) {
    return '-'
  }

  return JSON.stringify(args)
}

function formatKeymapChord(chord: string) {
  return chord
    .split('+')
    .map((part) => formatKeymapChordPart(part.trim()))
    .join('+')
}

function formatKeymapChordPart(part: string) {
  const normalized = part.toLowerCase()
  const modifierDisplay = keymapModifierDisplay[normalized]
  if (modifierDisplay) {
    return modifierDisplay
  }

  if (normalized.length === 1 && /[a-z]/.test(normalized)) {
    return normalized.toUpperCase()
  }

  return part
}

function keyboardEventToKeymapChord(event: KeyboardEvent) {
  if (isModifierKey(event.key)) {
    return null
  }

  const key = normalizeEventKey(event)
  if (!key) {
    return null
  }

  const parts: string[] = []
  const usesMod = isMacPlatform() ? event.metaKey : event.ctrlKey

  if (usesMod) {
    parts.push('mod')
  } else {
    if (event.ctrlKey) {
      parts.push('ctrl')
    }
    if (event.metaKey) {
      parts.push('meta')
    }
  }

  if (event.altKey) {
    parts.push('alt')
  }
  if (event.shiftKey) {
    parts.push('shift')
  }
  parts.push(key)

  return parts.join('+')
}

function isModifierKey(key: string) {
  return key === 'Control' || key === 'Meta' || key === 'Shift' || key === 'Alt'
}

function isMacPlatform() {
  if (typeof navigator === 'undefined') {
    return false
  }

  return /mac|iphone|ipad|ipod/i.test(navigator.platform)
}
