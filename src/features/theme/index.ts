import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, effect, signal } from '@preact/signals'
import {
  type ThemeName,
  themeAttribute,
  themeNames,
} from '@kittycad/ui-kit/tokens'
import { commandsValueSpec } from '@src/contracts/commands'
import { type ThemeSetting, themeService } from '@src/contracts/theme'

const STORAGE_KEY = 'zds.theme'

const settings: ThemeSetting[] = ['dark', 'light', 'system']

function readStored(): ThemeSetting {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && settings.includes(stored as ThemeSetting)) {
      return stored as ThemeSetting
    }
  } catch {
    // Private browsing and locked-down desktop profiles can both refuse
    // storage. A theme is not worth failing a boot over.
  }
  return 'system'
}

/**
 * Resolves and applies the colour theme.
 *
 * The resolved theme is written to one attribute on the root element, which is
 * the only hook the token set needs. No component subscribes to the theme, and
 * nothing re-renders when it changes — the cascade does all the work.
 */
export default defineRegistryItemFactory(() => {
  const setting = signal<ThemeSetting>(readStored())
  const systemPrefersDark =
    typeof window !== 'undefined' && 'matchMedia' in window
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null
  const systemDark = signal(systemPrefersDark?.matches ?? true)

  const onSystemChange = (event: MediaQueryListEvent) => {
    systemDark.value = event.matches
  }
  systemPrefersDark?.addEventListener('change', onSystemChange)

  const resolved = computed<ThemeName>(() => {
    if (setting.value !== 'system') return setting.value
    return systemDark.value ? 'dark' : 'light'
  })

  const stopApplying = effect(() => {
    document.documentElement.setAttribute(themeAttribute, resolved.value)
  })

  const set = (next: ThemeSetting) => {
    setting.value = next
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Persisting is best-effort; the session still gets the theme.
    }
  }

  const cycle = () => {
    const index = settings.indexOf(setting.peek())
    set(settings[(index + 1) % settings.length])
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'theme',
      dispose: () => {
        stopApplying()
        systemPrefersDark?.removeEventListener('change', onSystemChange)
      },
      providesServices: [
        provideService(themeService, {
          setting: computed(() => setting.value),
          resolved,
          set,
          cycle,
        }),
      ],
      provides: [
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
