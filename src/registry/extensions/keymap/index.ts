import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import type { StatusBarItemType } from '@src/components/StatusBar/statusBarTypes'
import type { Command, CommandScopes } from '@src/lib/commandTypes'
import makeUrlPathRelative from '@src/lib/makeUrlPathRelative'
import { PATHS, webSafeJoin } from '@src/lib/paths'
import { reportRejection } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import {
  COMMAND_PALETTE_OPEN_COMMAND_SCOPE,
  DEFAULT_COMMAND_SCOPES,
  EDITABLE_FOCUSED_COMMAND_SCOPE,
  GLOBAL_COMMAND_SCOPES,
  SETTINGS_COMMAND_SCOPE,
  commandKey,
  commandScopeService,
  commandScopesValueSpec,
  commandSystemService,
  getEffectiveCommandScopeSet,
  isCommandAvailable,
  type CommandScopeService,
} from '@src/registry/contracts/commands'
import {
  CODE_EDITOR_FOCUSED_KEYMAP_SCOPE,
  CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE,
  type KeymapArguments,
  type KeymapItem,
  type KeymapService,
  type KeymapSource,
  createEmptyPersistedKeymap,
  createKeymapTree,
  createUnbindBinding,
  keymapService,
  keymapValueSpec,
  matchKeymapKeystrokes,
  normalizeEventKey,
  resolveKeymapItems,
} from '@src/registry/contracts/keymap'
import { statusBarLocalItemsValueSpec } from '@src/registry/contracts/statusBar'
import { defaultKeymapItem } from '@src/registry/extensions/keymap/defaultKeymap'
import {
  readUserKeymapFile,
  writeUserKeymapFile,
} from '@src/registry/extensions/keymap/persistence'
import { createElement } from 'react'

const PARTIAL_MATCH_TIMEOUT_MS = 1500
type SettingsKeymapTab = 'project' | 'user' | 'keybindings' | 'plugins'

type BuiltInKeymapCommand = {
  scopes: CommandScopes
  run: (item: KeymapItem) => unknown
}

const keymapExtension = defineRegistryItemFactory((ctx) => {
  const contributedKeymapSignal = ctx.valueSpecs.signal(keymapValueSpec)
  const commandScopesSignal = ctx.valueSpecs.signal(commandScopesValueSpec)
  const persistedKeymap = signal(createEmptyPersistedKeymap())
  const keymapSignal = computed(() =>
    createKeymapTree(
      resolveKeymapItems(
        contributedKeymapSignal.value.items,
        persistedKeymap.value
      )
    )
  )
  const activeScopes = signal<readonly string[]>([
    CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE,
  ])
  const partialMatch = signal(false)
  const partialMatchProgress = signal(0)
  const builtInKeymapCommands = new Map<string, BuiltInKeymapCommand>([
    [
      'zds.commandPalette.open',
      {
        scopes: GLOBAL_COMMAND_SCOPES,
        run: () =>
          ctx.services.optional(commandSystemService)?.send({ type: 'Open' }),
      },
    ],
    [
      'zds.commandPalette.close',
      {
        scopes: [COMMAND_PALETTE_OPEN_COMMAND_SCOPE],
        run: () =>
          ctx.services.optional(commandSystemService)?.send({ type: 'Close' }),
      },
    ],
    [
      'zds.settings.open',
      {
        scopes: GLOBAL_COMMAND_SCOPES,
        run: openSettings,
      },
    ],
    [
      'zds.settings.tab',
      {
        scopes: [SETTINGS_COMMAND_SCOPE],
        run: (item) =>
          updateSettingsTab(getSettingsTabArgument(item.arguments)),
      },
    ],
  ])

  const scopeServiceImpl: CommandScopeService = {
    activeScopes,
    applyScope: (scopeName) => {
      if (activeScopes.value.includes(scopeName)) {
        return
      }
      activeScopes.value = [...activeScopes.value, scopeName]
    },
    removeScope: (scopeName) => {
      activeScopes.value = activeScopes.value.filter(
        (scope) => scope !== scopeName
      )
    },
    getCurrentScopes: () => activeScopes.value,
    focusScope: (scopeName) => ({
      onFocus: () => scopeServiceImpl.applyScope(scopeName),
      onBlur: () => scopeServiceImpl.removeScope(scopeName),
    }),
  }

  const pendingKeystrokesBySource: Record<KeymapSource, string[]> = {
    global: [],
    codeMirror: [],
  }
  /**
   * Reference count for temporarily disabling keymap handling. A count is used
   * instead of a boolean so overlapping callers can suspend listening
   * independently and keymaps resume only after every cleanup callback has run.
   */
  let suspendListeningCount = 0
  let persistedKeymapRevision = 0
  let pendingTimeout: number | undefined
  let pendingAnimationFrame: number | undefined

  const clearPendingKeystrokes = () => {
    pendingKeystrokesBySource.global = []
    pendingKeystrokesBySource.codeMirror = []
    partialMatch.value = false
    partialMatchProgress.value = 0
    if (pendingTimeout !== undefined) {
      window.clearTimeout(pendingTimeout)
      pendingTimeout = undefined
    }
    if (pendingAnimationFrame !== undefined) {
      window.cancelAnimationFrame(pendingAnimationFrame)
      pendingAnimationFrame = undefined
    }
  }

  const initialPersistedKeymapLoad = readUserKeymapFile()
    .then((keymap) => {
      if (persistedKeymapRevision === 0) {
        persistedKeymap.value = keymap
      }
    })
    .catch((error) => {
      if (error !== undefined) {
        reportRejection(error)
      }
    })

  const schedulePendingKeystrokesReset = () => {
    if (pendingTimeout !== undefined) {
      window.clearTimeout(pendingTimeout)
    }

    pendingTimeout = window.setTimeout(
      clearPendingKeystrokes,
      PARTIAL_MATCH_TIMEOUT_MS
    )

    const startedAt = window.performance.now()
    partialMatchProgress.value = 1

    const updateProgress = (now: number) => {
      const elapsed = now - startedAt
      partialMatchProgress.value = Math.max(
        0,
        1 - elapsed / PARTIAL_MATCH_TIMEOUT_MS
      )

      if (partialMatchProgress.value > 0) {
        pendingAnimationFrame = window.requestAnimationFrame(updateProgress)
      }
    }

    if (pendingAnimationFrame !== undefined) {
      window.cancelAnimationFrame(pendingAnimationFrame)
    }
    pendingAnimationFrame = window.requestAnimationFrame(updateProgress)
  }

  const handleKeyDown: KeymapService['handleKeyDown'] = (event, { source }) => {
    if (suspendListeningCount > 0) {
      return false
    }

    const chord = keyboardEventToKeymapChord(event)
    const pendingKeystrokes = pendingKeystrokesBySource[source]
    if (
      !chord ||
      (source === 'global' &&
        shouldIgnoreKeyboardEvent(event, pendingKeystrokes.length > 0))
    ) {
      return false
    }

    const commandSystem = ctx.services.optional(commandSystemService)
    const registeredCommands =
      commandSystem?.actor.getSnapshot().context.commands ?? []
    const commandsByKey = new Map<string, Command>()
    for (const command of registeredCommands) {
      const key = commandKey(command)
      if (!commandsByKey.has(key)) {
        commandsByKey.set(key, command)
      }
    }
    const effectiveCommandScopes = getEffectiveCommandScopeSet(
      activeScopes.value,
      commandScopesSignal.value
    )
    const isItemAvailable = (item: KeymapItem) => {
      const command =
        builtInKeymapCommands.get(item.command) ??
        commandsByKey.get(item.command)
      return (
        command !== undefined &&
        isCommandAvailable(command, effectiveCommandScopes)
      )
    }

    const match = matchKeymapKeystrokes(
      keymapSignal.value,
      activeScopes.value,
      [...pendingKeystrokes, chord],
      commandScopesSignal.value,
      isItemAvailable
    )

    if (match.type === 'prefix') {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      pendingKeystrokesBySource[source] = [...pendingKeystrokes, chord]
      partialMatch.value = true
      schedulePendingKeystrokesReset()
      return true
    }

    if (match.type === 'full') {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      clearPendingKeystrokes()
      runKeymapItem(match.item, commandsByKey, isItemAvailable(match.item))
      return true
    }

    if (pendingKeystrokes.length === 0) {
      return false
    }

    clearPendingKeystrokes()

    const retryMatch = matchKeymapKeystrokes(
      keymapSignal.value,
      activeScopes.value,
      [chord],
      commandScopesSignal.value,
      isItemAvailable
    )

    if (retryMatch.type === 'prefix') {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      pendingKeystrokesBySource[source] = [chord]
      partialMatch.value = true
      schedulePendingKeystrokesReset()
      return true
    }

    if (retryMatch.type === 'full') {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      runKeymapItem(
        retryMatch.item,
        commandsByKey,
        isItemAvailable(retryMatch.item)
      )
      return true
    }

    return false
  }

  const serviceImpl: KeymapService = {
    keymap: keymapSignal,
    persistedKeymap,
    partialMatch,
    applyScope: scopeServiceImpl.applyScope,
    removeScope: scopeServiceImpl.removeScope,
    getCurrentScopes: scopeServiceImpl.getCurrentScopes,
    savePersistedKeymap: async (keymap) => {
      await initialPersistedKeymapLoad
      persistedKeymapRevision += 1
      persistedKeymap.value = keymap
      await writeUserKeymapFile(keymap)
    },
    addUserBinding: async (binding) => {
      await serviceImpl.savePersistedKeymap({
        ...persistedKeymap.value,
        bindings: [...persistedKeymap.value.bindings, binding],
      })
    },
    removeUserBinding: async (index) => {
      await serviceImpl.savePersistedKeymap({
        ...persistedKeymap.value,
        bindings: persistedKeymap.value.bindings.filter(
          (_binding, bindingIndex) => bindingIndex !== index
        ),
      })
    },
    unbind: async (item) => {
      await serviceImpl.addUserBinding(createUnbindBinding(item))
    },
    /**
     * Used by UI that needs to capture raw keystrokes for another purpose, such
     * as the editable keybinding field in Settings. While suspended,
     * `handleKeyDown` ignores global and CodeMirror keymap matches so the
     * caller's own keydown listener can record chords without triggering app
     * commands. The returned function must be called when capture ends.
     */
    suspendListening: () => {
      suspendListeningCount += 1
      clearPendingKeystrokes()
      return () => {
        suspendListeningCount = Math.max(0, suspendListeningCount - 1)
      }
    },
    handleKeyDown,
    focusScope: scopeServiceImpl.focusScope,
  }

  function runKeymapItem(
    item: KeymapItem,
    commandsByKey: ReadonlyMap<string, Command>,
    isAvailable: boolean
  ) {
    if (!isAvailable) {
      return
    }

    const builtInCommand = builtInKeymapCommands.get(item.command)
    const result = builtInCommand
      ? builtInCommand.run(item)
      : runCommandById(item, commandsByKey)
    if (result instanceof Promise) {
      result.catch(reportRejection)
    }
  }

  function runCommandById(
    item: KeymapItem,
    commandsByKey: ReadonlyMap<string, Command>
  ) {
    const commandSystem = ctx.services.optional(commandSystemService)
    const command = commandsByKey.get(item.command)
    if (!command || !commandSystem) {
      return
    }

    const argDefaultValues = isKeymapArgumentRecord(item.arguments)
      ? item.arguments
      : undefined

    return commandSystem.send({
      type: 'Find and select command',
      data: {
        groupId: command.groupId,
        name: String(command.name),
        ...(argDefaultValues ? { argDefaultValues } : {}),
      },
    })
  }

  const PartialMatchStatusBarItem = () => {
    useSignals()
    if (!partialMatch.value) {
      return null
    }

    return createElement(
      'div',
      {
        role: 'tooltip',
        className:
          'relative flex items-center overflow-hidden px-2 py-1 text-xs text-chalkboard-80 dark:text-chalkboard-30',
        'data-testid': 'keymap-partial-match-status',
      },
      createElement('div', {
        className: 'absolute left-0 top-0 h-0.5 bg-primary',
        style: {
          width: `${Math.round(partialMatchProgress.value * 100)}%`,
        },
      }),
      createElement('span', null, 'Partial keymap match, awaiting input...')
    )
  }

  const handleGlobalKeyDown = (event: KeyboardEvent) => {
    handleKeyDown(event, { source: 'global' })
  }

  const syncFocusScopeFromEventTarget = (target: EventTarget | null) => {
    if (isEventFromCodeEditor(target)) {
      scopeServiceImpl.removeScope(CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE)
      scopeServiceImpl.removeScope(EDITABLE_FOCUSED_COMMAND_SCOPE)
      scopeServiceImpl.applyScope(CODE_EDITOR_FOCUSED_KEYMAP_SCOPE)
      return
    }

    scopeServiceImpl.removeScope(CODE_EDITOR_FOCUSED_KEYMAP_SCOPE)
    if (isEventFromEditableTarget(target)) {
      scopeServiceImpl.removeScope(CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE)
      scopeServiceImpl.applyScope(EDITABLE_FOCUSED_COMMAND_SCOPE)
      return
    }

    scopeServiceImpl.removeScope(EDITABLE_FOCUSED_COMMAND_SCOPE)
    scopeServiceImpl.applyScope(CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE)
  }

  const handleGlobalFocusIn = (event: FocusEvent) => {
    syncFocusScopeFromEventTarget(event.target)
  }

  const handleGlobalPointerDown = (event: PointerEvent) => {
    syncFocusScopeFromEventTarget(event.target)
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleGlobalKeyDown, { capture: true })
    window.addEventListener('focusin', handleGlobalFocusIn, { capture: true })
    window.addEventListener('pointerdown', handleGlobalPointerDown, {
      capture: true,
    })
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'keymap-extension',
      providesServices: [
        provideService(commandScopeService, scopeServiceImpl),
        provideService(keymapService, serviceImpl),
      ],
      provides: [
        ...DEFAULT_COMMAND_SCOPES.map((scope) =>
          provide(commandScopesValueSpec, scope, { key: scope.id })
        ),
        provide(
          statusBarLocalItemsValueSpec,
          computed((): StatusBarItemType | null =>
            partialMatch.value
              ? {
                  id: 'keymap.partial-match',
                  component: PartialMatchStatusBarItem,
                  order: -100,
                }
              : null
          ),
          { key: 'keymap.partial-match' }
        ),
      ],
      dispose: () => {
        clearPendingKeystrokes()
        if (typeof window !== 'undefined') {
          window.removeEventListener('keydown', handleGlobalKeyDown, {
            capture: true,
          })
          window.removeEventListener('focusin', handleGlobalFocusIn, {
            capture: true,
          })
          window.removeEventListener('pointerdown', handleGlobalPointerDown, {
            capture: true,
          })
        }
      },
    }),
  }
}, 'keymap-extension')

const keymapRegistryItem = defineRegistryItem({
  id: 'keymap',
  uses: [keymapExtension, defaultKeymapItem],
})

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

function shouldIgnoreKeyboardEvent(
  event: KeyboardEvent,
  hasPendingKeystrokes: boolean
) {
  if (event.metaKey || event.ctrlKey || event.altKey || hasPendingKeystrokes) {
    return false
  }

  return (
    isEventFromFormControl(event.target) ||
    isEventFromContentEditableTarget(event.target)
  )
}

function isEventFromCodeEditor(target: EventTarget | null) {
  return target instanceof Element && target.closest('.cm-editor') !== null
}

function isEventFromEditableTarget(target: EventTarget | null) {
  return (
    isEventFromContentEditableTarget(target) || isEventFromFormControl(target)
  )
}

function isEventFromContentEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return target.isContentEditable
}

function isEventFromFormControl(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
}

function openSettings() {
  const pathname = getRouterPathname()
  const settingsPath = pathname.includes(PATHS.SETTINGS)
    ? pathname
    : webSafeJoin([pathname, makeUrlPathRelative(PATHS.SETTINGS)])

  pushRouterPath(
    `${settingsPath}${pathname.includes(PATHS.FILE) ? '?tab=project' : ''}`
  )
}

function updateSettingsTab(tab: SettingsKeymapTab) {
  updateRouterSearchParams((searchParams) => {
    searchParams.set('tab', tab)
  })
}

function getSettingsTabArgument(args: KeymapArguments | undefined) {
  if (
    isKeymapArgumentRecord(args) &&
    (args.tab === 'project' ||
      args.tab === 'user' ||
      args.tab === 'keybindings' ||
      args.tab === 'plugins')
  ) {
    return args.tab
  }

  return 'user'
}

function isKeymapArgumentRecord(
  args: KeymapArguments | undefined
): args is { readonly [key: string]: KeymapArguments } {
  return Boolean(args && typeof args === 'object' && !isArray(args))
}

function getRouterPathname() {
  if (typeof window === 'undefined') {
    return '/'
  }

  const hashPath = getHashRouterPath()
  if (hashPath) {
    return hashPath.pathname
  }

  return window.location.pathname
}

function getHashRouterPath() {
  if (typeof window === 'undefined' || !window.location.hash.startsWith('#/')) {
    return null
  }

  return new URL(window.location.hash.slice(1), window.location.origin)
}

function pushRouterPath(pathAndSearch: string) {
  if (typeof window === 'undefined') {
    return
  }

  if (window.location.hash.startsWith('#/')) {
    const url = new URL(window.location.href)
    url.hash = `#${pathAndSearch}`
    window.history.pushState(null, '', url)
  } else {
    window.history.pushState(null, '', pathAndSearch)
  }

  window.dispatchEvent(new Event('popstate'))
}

function updateRouterSearchParams(
  update: (searchParams: URLSearchParams) => void
) {
  if (typeof window === 'undefined') {
    return
  }

  const hashPath = getHashRouterPath()
  if (hashPath) {
    update(hashPath.searchParams)
    const url = new URL(window.location.href)
    url.hash = `#${hashPath.pathname}${hashPath.search}${hashPath.hash}`
    window.history.pushState(null, '', url)
  } else {
    const url = new URL(window.location.href)
    update(url.searchParams)
    window.history.pushState(null, '', url)
  }

  window.dispatchEvent(new Event('popstate'))
}

export default keymapRegistryItem
