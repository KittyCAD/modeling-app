import { useComputed, useSignal } from '@preact/signals'
import type { Signal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { Icon, TextField } from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import type { Command } from '@src/contracts/commands'
import { commandService } from '@src/contracts/commands'
import { keybindingService } from '@src/contracts/keybindings'
import { matchesQuery } from '@src/lib/format'
import './commandPalette.css'

interface CommandPaletteProps {
  open: Signal<boolean>
}

/**
 * The command palette.
 *
 * A view over the command registry with no behaviour of its own — it filters,
 * highlights, and runs. Unavailable commands stay listed and disabled rather
 * than disappearing, so the palette also answers "why can't I do that yet".
 */
export function CommandPalette({ open }: CommandPaletteProps) {
  const commands = useService(commandService)
  const keys = useService(keybindingService)

  const query = useSignal('')
  const highlighted = useSignal(0)
  const listRef = useRef<HTMLUListElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const matches = useComputed(() =>
    commands.all.value.filter(
      (command) =>
        matchesQuery(command.title, query.value) ||
        matchesQuery(command.category ?? '', query.value)
    )
  )

  const isEnabled = (command: Command) => command.enabled?.value ?? true

  // Reset the query each time it opens: a palette that remembers the last
  // search makes the second use slower than the first. Focus is taken
  // explicitly rather than left to the `autofocus` attribute, because the
  // element is inserted long after parse and a palette that opens without the
  // caret in it is a palette you have to click.
  useEffect(() => {
    if (!open.value) return
    query.value = ''
    highlighted.value = 0
    inputRef.current?.focus()
  }, [open.value, query, highlighted])

  const close = () => {
    open.value = false
  }

  const runHighlighted = () => {
    const command = matches.value[highlighted.value]
    if (!command || !isEnabled(command)) return
    close()
    commands.run(command.id)
  }

  const move = (delta: number) => {
    const count = matches.value.length
    if (count === 0) return
    // Wrap, so holding the key cycles instead of stalling at the ends.
    highlighted.value = (highlighted.value + delta + count) % count

    listRef.current
      ?.querySelector(`[data-index="${highlighted.value}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }

  /**
   * Keys are handled at the window while the palette is open, not on the sheet.
   *
   * A modal has to answer Escape wherever focus happens to be — including
   * nowhere, which is what a click on the scrim leaves behind. Capturing also
   * means the arrow keys drive the highlight instead of the text caret.
   */
  useEffect(() => {
    if (!open.value) return

    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'Escape':
          event.preventDefault()
          event.stopPropagation()
          close()
          break
        case 'ArrowDown':
          event.preventDefault()
          event.stopPropagation()
          move(1)
          break
        case 'ArrowUp':
          event.preventDefault()
          event.stopPropagation()
          move(-1)
          break
        case 'Enter':
          event.preventDefault()
          event.stopPropagation()
          runHighlighted()
          break
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () =>
      window.removeEventListener('keydown', onKeyDown, { capture: true })
  })

  if (!open.value) return null

  return (
    <div class="zds-palette">
      {/* A backdrop button rather than a click handler on a div, so dismissing
          works from the keyboard and is announced. */}
      <button
        type="button"
        class="zds-palette__scrim"
        aria-label="Close commands"
        onClick={close}
      />
      <div
        class="zds-palette__sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Commands"
      >
        <div class="zds-palette__search">
          <TextField
            label="Search commands"
            hideLabel
            icon="search"
            placeholder="Search commands"
            value={query}
            inputRef={inputRef}
            onValueInput={(value) => {
              query.value = value
              highlighted.value = 0
            }}
          />
        </div>

        {matches.value.length === 0 ? (
          <p class="zds-palette__empty">No command matches “{query.value}”.</p>
        ) : (
          <ul class="zds-palette__list zds-scroll" ref={listRef} role="listbox">
            {matches.value.map((command, index) => {
              const enabled = isEnabled(command)
              const shortcut = keys.displayFor(command.id) ?? command.shortcut

              return (
                <li key={command.id}>
                  <button
                    type="button"
                    class="zds-palette__row"
                    data-index={index}
                    role="option"
                    aria-selected={index === highlighted.value}
                    aria-disabled={!enabled}
                    disabled={!enabled}
                    onPointerEnter={() => {
                      highlighted.value = index
                    }}
                    onClick={() => {
                      close()
                      commands.run(command.id)
                    }}
                  >
                    {command.icon ? (
                      <Icon name={command.icon} size="small" />
                    ) : (
                      <span class="zds-palette__no-icon" aria-hidden="true" />
                    )}
                    <span class="zds-palette__title">{command.title}</span>
                    {command.category ? (
                      <span class="zds-palette__category zds-label">
                        {command.category}
                      </span>
                    ) : null}
                    {shortcut ? (
                      <kbd class="zds-palette__shortcut">{shortcut}</kbd>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
