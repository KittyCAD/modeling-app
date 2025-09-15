import { isModifierKey, mapKey, sortKeys } from '@src/lib/keyboard'
import { INTERACTION_MAP_SEPARATOR } from '@src/lib/constants'
import type {
  ShortcutCategory,
  MouseOrKeyboardEvent,
  ShortcutProps,
} from '@src/lib/shortcuts/types'
import toast from 'react-hot-toast'
import { platform } from '@src/lib/utils'
import { mouseButtonToName } from '@src/lib/shortcuts/utils'

type ShortcutMessage = {
  type: 'pending' | 'failure' | 'success'
  message: string
}

export class ShortcutService {
  shortcuts: Map<string, Shortcut>
  _currentSequence: string | null = null
  lastMessage: ShortcutMessage | null = null
  _fireEvent = (event: MouseEvent | KeyboardEvent) => {
    this.lastMessage = null
    this.resolveShortcut(event)
      .then((result) => {
        const resultType: ShortcutMessage['type'] | null =
          result && (result.type === 'success' || result.type === 'pending')
            ? result.type
            : null
        if (result && resultType) {
          this.lastMessage = { type: resultType, message: result.message }
        }
      })
      .catch((reason) => {
        this.lastMessage = { type: 'failure', message: reason }
      })
  }

  constructor(shortcuts: Shortcut[]) {
    this.shortcuts = new Map(shortcuts.map((s) => [s.id, s]))
  }

  start() {
    if (!globalThis || !globalThis.window) {
      return
    }

    window.addEventListener('keydown', this._fireEvent)
    window.addEventListener('mousedown', this._fireEvent)
  }
  stop() {
    window.removeEventListener('keydown', this._fireEvent)
    window.removeEventListener('mousedown', this._fireEvent)
  }

  get currentSequence() {
    return this._currentSequence
  }
  clearSequence() {
    this._currentSequence = null
  }

  appendToSequence(input: string) {
    this._currentSequence = (
      this._currentSequence ? this._currentSequence.concat(' ', input) : input
    ).trim()
  }

  /** Add a set of shortcuts */
  addShortcuts(newShortcuts: Shortcut[]) {
    for (const shortcut of newShortcuts) {
      if (this.shortcuts.get(shortcut.id)) {
        console.warn('assigned duplicate ID')
      }

      this.shortcuts.set(shortcut.id, shortcut)
    }
  }
  /** Remove a set of shortcuts by ID */
  removeShortcuts(toRemove: (Shortcut | string)[]) {
    for (const idOrShortcut of toRemove) {
      this.shortcuts.delete(
        typeof idOrShortcut === 'string' ? idOrShortcut : idOrShortcut.id
      )
    }
  }

  toggleShortcuts(idsToToggle: string[], shouldEnable: boolean) {
    for (const id of idsToToggle) {
      const match = this.shortcuts.get(id)
      if (match) {
        match.enabled = shouldEnable
      }
    }
  }

  addOverride(id: string, override: string) {
    const match = this.shortcuts.get(id)
    if (match) {
      match.override = override
    }
  }

  async resolveShortcut(input: MouseOrKeyboardEvent) {
    const resolvedInput =
      'key' in input ? mapKey(input.code) : mouseButtonToName(input.button)

    // if the key is already a modifier key, skip everything else and reject
    if (isModifierKey(resolvedInput)) {
      // We return an empty string so that we don't clear the currentSequence
      return
    }

    const modifiers = [
      input.ctrlKey && 'ctrl',
      input.shiftKey && 'shift',
      input.altKey && 'alt',
      input.metaKey && 'meta',
    ].filter((item) => item !== false)

    const step = [resolvedInput, ...modifiers]
      .sort(sortKeys)
      .join(INTERACTION_MAP_SEPARATOR)

    // Find all the sequences that start with the current sequence
    const searchString = (
      (this._currentSequence ? `${this._currentSequence} ` : '') + step
    ).toLowerCase()

    const p = platform()
    const shouldSearchForMod =
      (step.includes('meta') && p === 'macos') ||
      (step.includes('ctrl') && p !== 'macos')
    const keyToReplaceWithMod = shouldSearchForMod
      ? p === 'macos'
        ? 'meta'
        : 'ctrl'
      : null

    const matches = this.shortcuts
      .values()
      .filter((item) => {
        if (shouldSearchForMod && keyToReplaceWithMod !== null) {
          const modReplacedSearchString = searchString.replace(
            keyToReplaceWithMod,
            'mod'
          )
          return (
            item.sequence.startsWith(searchString) ||
            item.sequence.startsWith(modReplacedSearchString)
          )
        }

        return item.sequence.startsWith(searchString)
      })
      .toArray()

    console.log({
      shortcuts: this.shortcuts,
      searchString,
      matches,
      step,
      shouldSearchForMod,
      keyToReplaceWithMod,
    })

    // If we have no matches, reject the promise
    if (matches.length === 0) {
      this.clearSequence()
      return Promise.reject(`No prefix matches found for ${searchString}`)
    }

    const exactMatches = matches.filter((item) => {
      if (shouldSearchForMod && keyToReplaceWithMod !== null) {
        const modReplacedSearchString = searchString.replace(
          keyToReplaceWithMod,
          'mod'
        )
        return (
          item.sequence === searchString ||
          item.sequence === modReplacedSearchString
        )
      }

      return item.sequence === searchString
    })

    if (!exactMatches.length) {
      // We have a prefix match.
      // Reject the promise and return the step
      // so we can add it to currentSequence
      this.appendToSequence(step)
      input.preventDefault()
      return Promise.resolve({
        type: 'pending',
        message: this.currentSequence ?? 'no sequence',
      })
    }

    // Resolve to just one exact match
    const availableExactMatches = exactMatches.filter((item) => item.enabled)

    if (availableExactMatches.length === 0) {
      this.clearSequence()
      input.preventDefault()
      return Promise.reject(
        `exact matches, but none enabled: ${availableExactMatches.map((item) => item.id).toString()}`
      )
    }

    // return the last-added, available exact match
    this.clearSequence()
    input.preventDefault()
    return Promise.resolve({
      type: 'success',
      message:
        this.execute(availableExactMatches[availableExactMatches.length - 1]) ??
        'unknown',
    } satisfies ShortcutMessage)
  }

  execute(shortcut: Shortcut) {
    try {
      shortcut.fireAction()
      return shortcut.id
    } catch (error) {
      console.error(error)
      toast.error(`There was an error executing the action: ${shortcut.id}`)
    }
  }
}

export class Shortcut {
  /** A unique identifier for the shortcut */
  id: string
  /** A human-readable title */
  title: string
  /**
   * The sequence of keystrokes and/or mouse clicks that triggers the shortcut.
   * - letters are represented by their lowercase form (ex: 'k')
   * - clicks are LeftClick, MiddleButton, or RightClick
   * - modifiers are added to a keystroke or a click with `+` (ex: `mod+k` or `shift+LeftClick`)
   * - chord sequences are separated by spaces (ex: `ctrl+g n`)
   */
  sequence: string
  /** A user-settable override value that will be persisted with settings */
  override?: string
  /** A human-readable explanation of what this shortcut does */
  description: string
  /** A human-readable category for organization in the UI */
  category: ShortcutCategory
  /** A human-readable description of when this shortcut is available */
  enabledDescription: string
  /** The callback this shortcut fires */
  private _action: NonNullable<ShortcutProps['action']>
  private _enabled = false

  constructor(props: ShortcutProps) {
    this.id = props.id
    this.category = props.category
    this.title = props.title
    this.sequence = props.sequence
      .split(INTERACTION_MAP_SEPARATOR)
      .sort(sortKeys)
      .map(mapKey)
      .join(INTERACTION_MAP_SEPARATOR)
    this.description = props.description
    this._action = props.action || (() => {})
    this.enabledDescription = props.enabledDescription
  }

  get enabled() {
    return this._enabled
  }
  set enabled(newValue: boolean) {
    this._enabled = newValue
  }

  fireAction() {
    this._action()
  }
  setAction(action: NonNullable<ShortcutProps['action']>) {
    this._action = action
  }
}
