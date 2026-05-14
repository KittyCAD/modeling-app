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
import makeUrlPathRelative from '@src/lib/makeUrlPathRelative'
import { PATHS, webSafeJoin } from '@src/lib/paths'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import { reportRejection } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import {
  commandKey,
  commandSystemService,
} from '@src/registry/contracts/commands'
import {
  type KeymapArguments,
  type KeymapItem,
  type KeymapScope,
  type KeymapService,
  type KeymapSource,
  BASE_KEYMAP_SCOPE,
  CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE,
  keymapService,
  keymapScopesValueSpec,
  keymapValueSpec,
  matchKeymapKeystrokes,
} from '@src/registry/contracts/keymap'
import { statusBarLocalItemsValueSpec } from '@src/registry/contracts/statusBar'
import { defaultKeymapItem } from '@src/registry/extensions/keymap/defaultKeymap'
import { createElement } from 'react'

const PARTIAL_MATCH_TIMEOUT_MS = 1500
type SettingsKeymapTab = 'project' | 'user' | 'keybindings' | 'plugins'

const defaultKeymapScopes: readonly KeymapScope[] = [
  {
    id: BASE_KEYMAP_SCOPE,
    displayName: 'Base',
  },
  {
    id: 'cmd-palette-open',
    displayName: 'Command palette open',
  },
  {
    id: 'settings-open',
    displayName: 'Settings open',
  },
]

const keymapExtension = defineRegistryItemFactory((ctx) => {
  const keymapSignal = ctx.valueSpecs.signal(keymapValueSpec)
  const activeScopes = signal<readonly string[]>([
    CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE,
  ])
  const partialMatch = signal(false)
  const partialMatchProgress = signal(0)

  const pendingKeystrokesBySource: Record<KeymapSource, string[]> = {
    global: [],
    codeMirror: [],
  }
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
    const chord = keyboardEventToKeymapChord(event)
    const pendingKeystrokes = pendingKeystrokesBySource[source]
    if (
      !chord ||
      (source === 'global' &&
        shouldIgnoreKeyboardEvent(event, pendingKeystrokes.length > 0))
    ) {
      return false
    }

    const match = matchKeymapKeystrokes(
      keymapSignal.value,
      activeScopes.value,
      [...pendingKeystrokes, chord]
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
      runKeymapItem(match.item)
      return true
    }

    if (pendingKeystrokes.length === 0) {
      return false
    }

    clearPendingKeystrokes()

    const retryMatch = matchKeymapKeystrokes(
      keymapSignal.value,
      activeScopes.value,
      [chord]
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
      runKeymapItem(retryMatch.item)
      return true
    }

    return false
  }

  const serviceImpl: KeymapService = {
    keymap: keymapSignal,
    partialMatch,
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
    handleKeyDown,
    focusScope: (scopeName) => ({
      onFocus: () => serviceImpl.applyScope(scopeName),
      onBlur: () => serviceImpl.removeScope(scopeName),
    }),
  }

  const resetView = () => {
    const kclManager = ctx.services
      .optional(commandSystemService)
      ?.actor.getSnapshot().context.kclManager
    if (!kclManager) {
      return
    }

    resetCameraPosition({
      sceneInfra: kclManager.sceneInfra,
      engineCommandManager: kclManager.engineCommandManager,
      settingsActor: kclManager.systemDeps.settings,
    }).catch(reportRejection)
  }

  function runKeymapItem(item: KeymapItem) {
    const result = runBuiltInKeymapCommand(item)
    if (result instanceof Promise) {
      result.catch(reportRejection)
    }
  }

  function runBuiltInKeymapCommand(item: KeymapItem): unknown {
    switch (item.command) {
      case 'zds.commandPalette.open':
        return ctx.services
          .optional(commandSystemService)
          ?.send({ type: 'Open' })
      case 'zds.commandPalette.close':
        return ctx.services
          .optional(commandSystemService)
          ?.send({ type: 'Close' })
      case 'zds.settings.open':
        return openSettings()
      case 'zds.settings.tab':
        return updateSettingsTab(getSettingsTabArgument(item.arguments))
      case 'zds.view.reset':
        return resetView()
      default:
        return runCommandById(item)
    }
  }

  function runCommandById(item: KeymapItem) {
    const commandSystem = ctx.services.optional(commandSystemService)
    const command = commandSystem?.actor
      .getSnapshot()
      .context.commands.find((cmd) => commandKey(cmd) === item.command)
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

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleGlobalKeyDown, { capture: true })
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'keymap-extension',
      providesServices: [provideService(keymapService, serviceImpl)],
      provides: [
        ...defaultKeymapScopes.map((scope) =>
          provide(keymapScopesValueSpec, scope, { key: scope.id })
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

  const key = normalizeEventKey(event.key)
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

function normalizeEventKey(key: string) {
  if (key.length === 1) {
    return key.toLowerCase()
  }

  const normalized = key.toLowerCase()
  if (normalized === ' ') {
    return 'space'
  }

  return normalized
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

  const target = event.target
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
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
