import { useComputed, useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { Button, Icon, Select, TextField } from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import { type Command, commandService } from '@src/contracts/commands'
import {
  BASE_SCOPE,
  type Keybinding,
  keybindingService,
} from '@src/contracts/keybindings'
import {
  chordFromEvent,
  displayKeystrokes,
  normaliseKeystrokes,
} from '@src/features/keybindings/keymap'
import { persistedFor } from '@src/features/keybindings/persistedKeymap'
import './keybindings.css'

/**
 * Every command, and the keys that reach it.
 *
 * Commands rather than bindings, which is the opposite of how the file is
 * stored. The file is a list of overrides; this is the list of things the app can
 * do, and "what can I put a key on" is the question someone opens it with — a
 * command with no binding has to appear or it can never be given one.
 */
export function KeybindingsTable() {
  const commands = useService(commandService)
  const keys = useService(keybindingService)

  const query = useSignal('')

  /** The command being recorded, its chords so far, and the scope to store. */
  const recording = useSignal<{
    commandId: string
    chords: readonly string[]
    scopeId: string
  } | null>(null)

  const rows = useComputed(() => {
    const needle = query.value.trim().toLowerCase()

    return commands.all.value
      .filter((command) => {
        if (!needle) return true
        return `${command.category ?? ''} ${command.title} ${command.id}`
          .toLowerCase()
          .includes(needle)
      })
      .map((command) => ({
        command,
        bindings: keys.bindings.value.filter(
          (binding) => binding.commandId === command.id
        ),
        stored: persistedFor(keys.persisted.value, command.id),
      }))
      .toSorted(
        (a, b) =>
          (a.command.category ?? '').localeCompare(b.command.category ?? '') ||
          a.command.title.localeCompare(b.command.title)
      )
  })

  return (
    <div class="zds-keys">
      <div class="zds-keys__search">
        <TextField
          label="Filter commands"
          hideLabel
          size="small"
          icon="search"
          type="search"
          placeholder="Filter commands"
          value={query.value}
          onValueInput={(value) => {
            query.value = value
          }}
        />
      </div>

      <ul class="zds-keys__rows">
        {rows.value.map((row) => (
          <KeyRow
            key={row.command.id}
            command={row.command}
            bindings={row.bindings}
            storedCount={row.stored.length}
            recording={recording}
          />
        ))}
      </ul>

      {rows.value.length === 0 ? (
        <p class="zds-keys__empty">No command matches that.</p>
      ) : null}

      <ScopeList />

      <p class="zds-keys__location zds-value" title={keys.location.value}>
        {keys.location.value}
      </p>
    </div>
  )
}

type RecordingSignal = ReturnType<
  typeof useSignal<{
    commandId: string
    chords: readonly string[]
    scopeId: string
  } | null>
>

function KeyRow({
  command,
  bindings,
  storedCount,
  recording,
}: {
  command: Command
  bindings: readonly Keybinding[]
  storedCount: number
  recording: RecordingSignal
}) {
  const keys = useService(keybindingService)
  const isRecording = recording.value?.commandId === command.id

  const scopeOf = (binding: Keybinding) => binding.scopes?.[0] ?? BASE_SCOPE

  const scopeName = (scopeId: string) =>
    keys.scopes.value.find((scope) => scope.id === scopeId)?.displayName ??
    scopeId

  const start = () => {
    recording.value = {
      commandId: command.id,
      chords: [],
      scopeId: bindings[0] ? scopeOf(bindings[0]) : BASE_SCOPE,
    }
  }

  return (
    <li class="zds-keys__row" data-recording={isRecording ? 'true' : undefined}>
      <div class="zds-keys__what">
        <span class="zds-keys__title">{command.title}</span>
        <span class="zds-keys__category zds-label">
          {command.category ?? 'Other'}
        </span>
      </div>

      {isRecording ? (
        <Capture recording={recording} command={command} />
      ) : (
        <>
          <div class="zds-keys__keys">
            {bindings.length === 0 ? (
              <span class="zds-keys__unbound">
                {storedCount > 0 ? 'Unbound' : '—'}
              </span>
            ) : (
              bindings.map((binding) => (
                <span
                  key={binding.keystrokes.join(' ')}
                  class="zds-keys__chord"
                  title={
                    scopeOf(binding) === BASE_SCOPE
                      ? undefined
                      : `Only while: ${scopeName(scopeOf(binding))}`
                  }
                >
                  {displayKeystrokes(binding.keystrokes)}
                  {scopeOf(binding) === BASE_SCOPE ? null : (
                    <span class="zds-keys__scope zds-label">
                      {scopeName(scopeOf(binding))}
                    </span>
                  )}
                </span>
              ))
            )}
            {storedCount > 0 ? (
              <span class="zds-keys__source zds-label" title="From your keymap">
                yours
              </span>
            ) : null}
          </div>

          <div class="zds-keys__actions">
            <Button
              variant="ghost"
              size="small"
              iconOnly
              icon="pencil"
              label={`Change the keys for ${command.title}`}
              onClick={start}
            />
            {bindings.length > 0 ? (
              <Button
                variant="ghost"
                size="small"
                iconOnly
                icon="close"
                label={`Unbind ${command.title}`}
                onClick={() => void keys.unbind(command.id)}
              />
            ) : null}
            {storedCount > 0 ? (
              <Button
                variant="ghost"
                size="small"
                iconOnly
                icon="refresh"
                label={`Restore the default keys for ${command.title}`}
                onClick={() => void keys.restore(command.id)}
              />
            ) : null}
          </div>
        </>
      )}
    </li>
  )
}

/**
 * Recording keystrokes.
 *
 * The keymap is suspended for as long as this is open, which is the whole reason
 * `suspendListening` exists: `⌘K` cannot be recorded if the palette opens the
 * moment it is pressed. Modifiers alone are ignored, so holding ⌘ while you think
 * does not commit anything, and each further keystroke appends a chord — which is
 * how a sequence like `v 1` is entered.
 */
function Capture({
  recording,
  command,
}: {
  recording: RecordingSignal
  command: Command
}) {
  const keys = useService(keybindingService)
  const state = recording.value
  const chords = state?.chords ?? []

  useEffect(() => {
    const release = keys.suspendListening()

    const onKeyDown = (event: KeyboardEvent) => {
      const chord = chordFromEvent(event)
      if (!chord) return

      event.preventDefault()
      event.stopPropagation()

      const current = recording.peek()
      if (!current) return
      recording.value = { ...current, chords: [...current.chords, chord] }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      release()
    }
  }, [keys, recording])

  /**
   * Who else answers to these keys.
   *
   * Reported rather than refused: two commands on one chord in different scopes
   * is the normal case, and even in the same scope the user may be mid-way
   * through swapping two bindings. What is not acceptable is finding out later.
   */
  const conflicts = useComputed(() => {
    const wanted = normaliseKeystrokes(chords).join(' ')
    if (!wanted) return []

    return keys.bindings.value
      .filter(
        (binding) =>
          binding.commandId !== command.id &&
          normaliseKeystrokes(binding.keystrokes).join(' ') === wanted
      )
      .map((binding) => binding.commandId)
  })

  const scopeOptions = keys.scopes.value.map((scope) => ({
    value: scope.id,
    label: scope.displayName,
  }))

  const commit = () => {
    if (!state || chords.length === 0) return
    void keys.rebind(
      command.id,
      chords,
      state.scopeId === BASE_SCOPE ? undefined : [state.scopeId]
    )
    recording.value = null
  }

  return (
    <div class="zds-keys__capture">
      <div class="zds-keys__captured" aria-live="polite">
        <Icon name="command" size="small" />
        {chords.length === 0 ? (
          <span class="zds-keys__prompt">Press the keys you want…</span>
        ) : (
          <span class="zds-keys__chord">{displayKeystrokes(chords)}</span>
        )}
      </div>

      <Select
        label="Only while"
        hideLabel
        size="small"
        options={scopeOptions}
        value={state?.scopeId ?? BASE_SCOPE}
        onValueChange={(value) => {
          const current = recording.peek()
          if (current) recording.value = { ...current, scopeId: value }
        }}
      />

      <div class="zds-keys__actions">
        <Button
          size="small"
          label="Cancel"
          onClick={() => {
            recording.value = null
          }}
        />
        <Button
          size="small"
          variant="primary"
          label="Save"
          disabled={chords.length === 0}
          onClick={commit}
        />
      </div>

      {conflicts.value.length > 0 ? (
        <p class="zds-keys__conflict" role="status">
          Also used by {conflicts.value.join(', ')}. Yours will win.
        </p>
      ) : null}
    </div>
  )
}

/**
 * The scopes that exist, and which are live right now.
 *
 * Live matters more than it sounds: "why did that key do something else" is
 * almost always a scope being active, and a list that shows which ones are on
 * answers it without a debugger.
 */
function ScopeList() {
  const keys = useService(keybindingService)

  return (
    <section class="zds-keys__scopes">
      <h3 class="zds-keys__heading zds-label">Scopes</h3>
      <p class="zds-keys__note">
        A binding can be limited to one of these. The strongest active scope
        wins a contested chord.
      </p>
      <ul class="zds-keys__scope-list">
        {keys.scopes.value.map((scope) => {
          const active = keys.activeScopes.value.includes(scope.id)
          return (
            <li key={scope.id} class="zds-keys__scope-row">
              <span class="zds-keys__scope-name">{scope.displayName}</span>
              <span class="zds-value zds-keys__scope-id">{scope.id}</span>
              <span class="zds-label">{scope.priority ?? 0}</span>
              {active || scope.id === BASE_SCOPE ? (
                <span class="zds-keys__scope-active zds-label">active</span>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
