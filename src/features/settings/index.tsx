import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, effect, signal } from '@preact/signals'
import { appMenuSectionsValueSpec } from '@src/contracts/appMenu'
import { commandsValueSpec } from '@src/contracts/commands'
import { fileSystemService } from '@src/contracts/fileSystem'
import { fileWatcherService } from '@src/contracts/fileWatcher'
import { fsOperationQueueService } from '@src/contracts/fsOperations'
import {
  keybindingScopesValueSpec,
  keybindingService,
  keybindingsValueSpec,
} from '@src/contracts/keybindings'
import type { AppLocation } from '@src/contracts/navigation'
import {
  locationSourcesValueSpec,
  urlRoutesValueSpec,
} from '@src/contracts/navigation'
import { projectSessionService } from '@src/contracts/projectSession'
import { runtimeService } from '@src/contracts/runtime'
import {
  type SettingsLevel,
  settingsSectionsValueSpec,
  settingsService,
  settingsValueSpec,
  userSettingsStoreService,
} from '@src/contracts/settings'
import { overlaysValueSpec } from '@src/contracts/shell'
import { createSettingsService } from '@src/features/settings/createSettingsService'
import { SettingsDialog } from '@src/features/settings/SettingsDialog'
import {
  createBrowserUserSettingsStore,
  createDesktopUserSettingsStore,
} from '@src/features/settings/userSettingsStores'

/**
 * Settings: the cascade, and the surface that draws it.
 *
 * This feature owns no setting of its own. Every preference belongs to whatever
 * feature changes its behaviour, so adding one never touches this file — which
 * is the difference between a settings system and a settings file that everyone
 * edits.
 *
 * The dialog is addressable as `/settings/:section` but is not a screen: it
 * draws over whatever you were doing, and closing it returns you there. That is
 * what "dialog-type route" means here — the location source sits at the front of
 * the queue while it is open, and steps out of the way when it closes.
 */
/** Applied while the dialog is up, so its keys are only its own. */
const SETTINGS_SCOPE = 'settings.open'

export default defineRegistryItemFactory((ctx) => {
  // Chosen from the bridge rather than the runtime service: this runs during
  // graph construction, where resolving a service is not allowed.
  const bridge = typeof window !== 'undefined' ? window.electron : undefined
  const store = bridge
    ? createDesktopUserSettingsStore(bridge)
    : createBrowserUserSettingsStore()

  const settings = createSettingsService({
    definitions: computed(() => ctx.valueSpecs.get(settingsValueSpec)),
    sections: computed(() => ctx.valueSpecs.get(settingsSectionsValueSpec)),
    userStore: () => store,
    sessions: () => ctx.services.get(projectSessionService),
    fileSystem: () => ctx.services.get(fileSystemService),
    runtime: () => ctx.services.get(runtimeService),
    queue: () => ctx.services.get(fsOperationQueueService),
    watcher: () => ctx.services.optional(fileWatcherService),
  })

  /** Which level the dialog is editing. UI state, so it stays out of the URL. */
  const level = signal<SettingsLevel>('user')

  /**
   * Asking for the caret, as a count rather than a flag.
   *
   * The request is an event: pressing the shortcut twice has to focus twice, and
   * a boolean that is already true says nothing the second time.
   */
  const focusSearch = signal(0)

  /**
   * The dialog's keys, live only while it is up.
   *
   * A scope rather than an `enabled` command, because the dispatcher claims a
   * keystroke it has a binding for before anybody asks whether the command can
   * run — so a global `Ctrl+.` would be swallowed everywhere in the app and
   * quietly do nothing. Scoped, the keystroke is simply not ours when the dialog
   * is closed.
   *
   * Deferred by a microtask, as every effect that reads a service here is: the
   * container refuses a service read while the registry graph is being flattened.
   */
  let releaseScope = () => {}
  queueMicrotask(() => {
    const keys = ctx.services.get(keybindingService)
    let held = false

    releaseScope = effect(() => {
      const open = settings.openSection.value !== null
      if (open === held) return

      held = open
      if (open) keys.applyScope(SETTINGS_SCOPE)
      else keys.removeScope(SETTINGS_SCOPE)
    })
  })

  const location = computed<AppLocation | null>(() => {
    const section = settings.openSection.value
    return section === null ? null : { kind: 'settings', section }
  })

  return {
    model: settings,
    item: defineRuntimeRegistryItem({
      id: 'settings',
      dispose: () => {
        releaseScope()
        settings.dispose()
      },
      providesServices: [
        provideService(settingsService, settings),
        provideService(userSettingsStoreService, store),
      ],
      provides: [
        provide(overlaysValueSpec, {
          id: 'settings',
          order: 10,
          render: () => (
            <SettingsDialog level={level} focusSearch={focusSearch} />
          ),
        }),

        /**
         * First in line while open.
         *
         * A dialog is where the app *is* for as long as it is up — a link
         * copied from the address bar should reopen it, not the screen behind
         * it. Returning null the rest of the time is what lets the underlying
         * screen own the URL again the moment it closes.
         */
        provide(locationSourcesValueSpec, {
          id: 'settings',
          order: 0,
          location,
        }),
        provide(urlRoutesValueSpec, {
          id: 'settings',
          // Ahead of every other route, because this one also has to notice
          // URLs that are *not* settings: a Back out of the dialog arrives as
          // a plain URL, and something has to close what the URL no longer
          // describes. Returning false then lets the real route claim it.
          order: -10,
          toPath: (current) =>
            current.kind === 'settings'
              ? current.section
                ? `/settings/${encodeURIComponent(current.section)}`
                : '/settings'
              : null,
          load: (url) => {
            const match = url.pathname.match(/^\/settings(?:\/([^/]+))?$/)
            if (!match) {
              settings.close()
              return false
            }
            settings.open(match[1] ? decodeURIComponent(match[1]) : undefined)
            return true
          },
        }),

        provide(commandsValueSpec, {
          id: 'settings.open',
          title: 'Open settings',
          category: 'General',
          icon: 'gear',
          run: () => settings.open(),
        }),
        provide(commandsValueSpec, {
          id: 'settings.close',
          title: 'Close settings',
          category: 'General',
          icon: 'close',
          enabled: computed(() => settings.openSection.value !== null),
          run: () => settings.close(),
        }),
        provide(keybindingsValueSpec, {
          keystrokes: ['Mod+,'],
          commandId: 'settings.open',
        }),

        /**
         * Search from the keyboard.
         *
         * `/`, the convention everywhere a list can be filtered. It is safe as a
         * bare key because the dispatcher yields an unmodified keystroke to any
         * focused input before it looks for a binding — so typing a slash *into*
         * the search field types a slash, and only a slash pressed with the
         * dialog itself focused takes the caret.
         */
        provide(keybindingScopesValueSpec, {
          id: SETTINGS_SCOPE,
          displayName: 'Settings open',
          priority: 500,
        }),
        provide(commandsValueSpec, {
          id: 'settings.searchFocus',
          title: 'Search settings',
          category: 'General',
          icon: 'search',
          enabled: computed(() => settings.openSection.value !== null),
          run: () => {
            focusSearch.value += 1
          },
        }),
        provide(keybindingsValueSpec, {
          keystrokes: ['/'],
          scopes: [SETTINGS_SCOPE],
          commandId: 'settings.searchFocus',
        }),

        provide(appMenuSectionsValueSpec, {
          id: 'appMenu.settings',
          order: 150,
          items: [
            {
              id: 'settings',
              label: 'Settings',
              icon: 'gear',
              commandId: 'settings.open',
            },
          ],
        }),

        /**
         * The app's own taxonomy.
         *
         * Sections are contributed too, so a plugin can add a group — but the
         * core ones live here rather than with the features that fill them:
         * "Appearance" is where someone looks for the theme, not where the
         * theme happens to be implemented.
         */
        provide(settingsSectionsValueSpec, {
          id: 'appearance',
          title: 'Appearance',
          description: 'How the app looks.',
          icon: 'sun',
          order: 0,
        }),
        provide(settingsSectionsValueSpec, {
          id: 'modeling',
          title: 'Modeling',
          description: 'How geometry is drawn and how the view behaves.',
          icon: 'cube',
          order: 10,
        }),
        provide(settingsSectionsValueSpec, {
          id: 'editor',
          title: 'Editor',
          description: 'How code editing behaves.',
          icon: 'fileCode',
          order: 20,
        }),
      ],
    }),
  }
}, 'settings')
