import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import {
  type ThemeName,
  themeAttribute,
  themeNames,
} from '@kittycad/ui-kit/tokens'
import { computed, effect, signal } from '@preact/signals'
import { commandsValueSpec } from '@src/contracts/commands'
import { settingsService, settingsValueSpec } from '@src/contracts/settings'
import { type ThemeSetting, themeService } from '@src/contracts/theme'
import { themeSetting } from '@src/features/theme/settings'

/**
 * Last applied theme, cached for the first paint.
 *
 * Not the source of truth — that is the setting — but the settings file is read
 * asynchronously, and a light-theme user should not watch the app load dark
 * first. Written on every change, read once at boot.
 */
const PAINT_CACHE_KEY = 'zds.theme.applied'

const order: ThemeSetting[] = ['dark', 'light', 'system']

function readPaintCache(): ThemeName | null {
  try {
    const stored = localStorage.getItem(PAINT_CACHE_KEY)
    return stored && themeNames.includes(stored as ThemeName)
      ? (stored as ThemeName)
      : null
  } catch {
    // Private browsing and locked-down desktop profiles both refuse storage.
    // A first paint is not worth failing a boot over.
    return null
  }
}

/**
 * Resolves and applies the colour theme.
 *
 * The choice lives in the settings cascade like every other preference; this
 * feature only turns it into one attribute on the root element, which is the
 * only hook the token set needs. No component subscribes to the theme and
 * nothing re-renders when it changes — the cascade does all the work.
 */
export default defineRegistryItemFactory((ctx) => {
  const settings = () => ctx.services.get(settingsService)

  const systemPrefersDark =
    typeof window !== 'undefined' && 'matchMedia' in window
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null
  const systemDark = signal(systemPrefersDark?.matches ?? true)

  const onSystemChange = (event: MediaQueryListEvent) => {
    systemDark.value = event.matches
  }
  systemPrefersDark?.addEventListener('change', onSystemChange)

  const setting = computed<ThemeSetting>(
    () => settings().value(themeSetting).value
  )

  const resolved = computed<ThemeName>(() => {
    if (setting.value !== 'system') return setting.value
    return systemDark.value ? 'dark' : 'light'
  })

  // The cached theme paints immediately; the resolved one takes over as soon as
  // the settings file has been read.
  const cached = readPaintCache()
  if (cached) document.documentElement.setAttribute(themeAttribute, cached)

  let stopApplying = () => {}
  // Deferred: this reads the settings service, and resolving a service while
  // the registry graph is still being flattened is a cycle.
  queueMicrotask(() => {
    stopApplying = effect(() => {
      const next = resolved.value
      document.documentElement.setAttribute(themeAttribute, next)
      try {
        localStorage.setItem(PAINT_CACHE_KEY, next)
      } catch {
        // Best effort; the session still gets the theme.
      }
    })
  })

  const set = (next: ThemeSetting) => {
    settings().set(themeSetting, 'user', next)
  }

  const cycle = () => {
    const index = order.indexOf(setting.peek())
    set(order[(index + 1) % order.length])
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'theme',
      dispose: () => {
        stopApplying()
        systemPrefersDark?.removeEventListener('change', onSystemChange)
      },
      providesServices: [
        provideService(themeService, { setting, resolved, set, cycle }),
      ],
      provides: [
        provide(settingsValueSpec, themeSetting),
        provide(commandsValueSpec, {
          id: 'theme.cycle',
          title: 'Switch theme',
          category: 'Appearance',
          icon: 'moon',
          run: cycle,
        }),
        ...themeNames.map((name) =>
          provide(commandsValueSpec, {
            id: `theme.set.${name}`,
            title: `Use ${name} theme`,
            category: 'Appearance',
            icon: name === 'dark' ? ('moon' as const) : ('sun' as const),
            run: () => set(name),
          })
        ),
        provide(commandsValueSpec, {
          id: 'theme.set.system',
          title: 'Match system theme',
          category: 'Appearance',
          icon: 'monitor',
          run: () => set('system'),
        }),
      ],
    }),
  }
}, 'theme')
