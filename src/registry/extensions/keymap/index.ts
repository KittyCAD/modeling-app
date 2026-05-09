import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import type { StatusBarItemType } from '@src/components/StatusBar/statusBarTypes'
import { isDesktop } from '@src/lib/isDesktop'
import makeUrlPathRelative from '@src/lib/makeUrlPathRelative'
import { PATHS, webSafeJoin } from '@src/lib/paths'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import { reportRejection } from '@src/lib/trap'
import { commandSystemService } from '@src/registry/contracts/commands'
import {
  type KeymapItem,
  type KeymapService,
  type KeymapSource,
  keymapService,
  keymapValueSpec,
  matchKeymapSequence,
} from '@src/registry/contracts/keymap'
import { statusBarLocalItemsValueSpec } from '@src/registry/contracts/statusBar'
import { createElement } from 'react'

const PARTIAL_MATCH_TIMEOUT_MS = 1500

const keymapExtension = defineRegistryItemFactory((ctx) => {
  const keymapSignal = ctx.valueSpecs.signal(keymapValueSpec)
  const activeScopes = signal<readonly string[]>([])
  const partialMatch = signal(false)
  const partialMatchProgress = signal(0)

  const pendingSequences: Record<KeymapSource, string[]> = {
    global: [],
    codeMirror: [],
  }
  let pendingTimeout: number | undefined
  let pendingAnimationFrame: number | undefined

  const clearPendingSequence = () => {
    pendingSequences.global = []
    pendingSequences.codeMirror = []
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

  const schedulePendingSequenceReset = () => {
    if (pendingTimeout !== undefined) {
      window.clearTimeout(pendingTimeout)
    }

    pendingTimeout = window.setTimeout(
      clearPendingSequence,
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
    const pendingSequence = pendingSequences[source]
    if (
      !chord ||
      (source === 'global' &&
        shouldIgnoreKeyboardEvent(event, pendingSequence.length > 0))
    ) {
      return false
    }

    const match = matchKeymapSequence(
      keymapSignal.value,
      activeScopes.value,
      [...pendingSequence, chord],
      source
    )

    if (match.type === 'prefix') {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      pendingSequences[source] = [...pendingSequence, chord]
      partialMatch.value = true
      schedulePendingSequenceReset()
      return true
    }

    if (match.type === 'full') {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      clearPendingSequence()
      runKeymapItem(match.item, event)
      return true
    }

    if (pendingSequence.length === 0) {
      return false
    }

    clearPendingSequence()

    const retryMatch = matchKeymapSequence(
      keymapSignal.value,
      activeScopes.value,
      [chord],
      source
    )

    if (retryMatch.type === 'prefix') {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      pendingSequences[source] = [chord]
      partialMatch.value = true
      schedulePendingSequenceReset()
      return true
    }

    if (retryMatch.type === 'full') {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      runKeymapItem(retryMatch.item, event)
      return true
    }

    return false
  }

  const serviceImpl: KeymapService = {
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

  const runCommand = (name: string, groupId: string) => {
    const commandSystem = ctx.services.get(commandSystemService)
    const command = commandSystem.actor
      .getSnapshot()
      .context.commands.find(
        (cmd) => cmd.name === name && cmd.groupId === groupId
      )

    const result = command?.onSubmit()
    if (result instanceof Promise) {
      result.catch(reportRejection)
    }
  }

  const resetView = () => {
    const kclManager = ctx.services
      .get(commandSystemService)
      .actor.getSnapshot().context.kclManager
    if (!kclManager) {
      return
    }

    resetCameraPosition({
      sceneInfra: kclManager.sceneInfra,
      engineCommandManager: kclManager.engineCommandManager,
      settingsActor: kclManager.systemDeps.settings,
    }).catch(reportRejection)
  }

  const defaultKeymapItems: readonly KeymapItem[] = [
    {
      id: 'command-palette.open',
      title: 'Open command palette',
      description: 'Open the command palette.',
      sequence: ['mod+k'],
      registerToCodeMirror: true,
      run: () => {
        ctx.services.get(commandSystemService).send({ type: 'Open' })
      },
    },
    {
      id: 'command-palette.close',
      title: 'Close command palette',
      description: 'Close the command palette.',
      scope: 'cmd-palette-open',
      sequence: ['mod+k'],
      registerToCodeMirror: true,
      run: () => {
        ctx.services.get(commandSystemService).send({ type: 'Close' })
      },
    },
    {
      id: 'settings.open',
      title: 'Open settings',
      description: 'Open the settings panel.',
      sequence: [isDesktop() ? 'mod+,' : 'mod+shift+,'],
      registerToCodeMirror: true,
      run: () => {
        openSettings()
      },
    },
    {
      id: 'settings.project',
      title: 'Project settings',
      description: 'Switch to project settings.',
      scope: 'settings-open',
      sequence: ['p'],
      run: () => {
        updateSettingsTab('project')
      },
    },
    {
      id: 'settings.user',
      title: 'User settings',
      description: 'Switch to user settings.',
      scope: 'settings-open',
      sequence: ['u'],
      run: () => {
        updateSettingsTab('user')
      },
    },
    {
      id: 'view.top',
      title: 'Top view',
      description: 'View the model from the top.',
      sequence: ['v', '1'],
      run: () => {
        runCommand('Top view', 'standardViews')
      },
    },
    {
      id: 'view.right',
      title: 'Right view',
      description: 'View the model from the right.',
      sequence: ['v', '2'],
      run: () => {
        runCommand('Right view', 'standardViews')
      },
    },
    {
      id: 'view.front',
      title: 'Front view',
      description: 'View the model from the front.',
      sequence: ['v', '3'],
      run: () => {
        runCommand('Front view', 'standardViews')
      },
    },
    {
      id: 'view.back',
      title: 'Back view',
      description: 'View the model from the back.',
      sequence: ['v', '4'],
      run: () => {
        runCommand('Back view', 'standardViews')
      },
    },
    {
      id: 'view.bottom',
      title: 'Bottom view',
      description: 'View the model from the bottom.',
      sequence: ['v', '5'],
      run: () => {
        runCommand('Bottom view', 'standardViews')
      },
    },
    {
      id: 'view.left',
      title: 'Left view',
      description: 'View the model from the left.',
      sequence: ['v', '6'],
      run: () => {
        runCommand('Left view', 'standardViews')
      },
    },
    {
      id: 'view.zoom-to-fit',
      title: 'Zoom to fit',
      description: 'Fit the model in the camera view.',
      sequence: ['v', 'f'],
      run: () => {
        runCommand('Zoom to fit', 'standardViews')
      },
    },
    {
      id: 'view.reset',
      title: 'Reset view',
      description: 'Reset the camera view.',
      sequence: ['v', 'r'],
      run: resetView,
    },
  ]

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
        ...defaultKeymapItems.map((item) =>
          provide(keymapValueSpec, item, { key: item.id })
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
        clearPendingSequence()
        if (typeof window !== 'undefined') {
          window.removeEventListener('keydown', handleGlobalKeyDown, {
            capture: true,
          })
        }
      },
    }),
  }
}, 'keymap-extension')

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

function runKeymapItem(item: KeymapItem, event: KeyboardEvent) {
  const result = item.run(event)
  if (result instanceof Promise) {
    result.catch(reportRejection)
  }
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
  hasPendingSequence: boolean
) {
  if (event.metaKey || event.ctrlKey || event.altKey || hasPendingSequence) {
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

function updateSettingsTab(tab: 'project' | 'user') {
  updateRouterSearchParams((searchParams) => {
    searchParams.set('tab', tab)
  })
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

export default keymapExtension
