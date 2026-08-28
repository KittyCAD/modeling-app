import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals'
import { appMenuSectionsValueSpec } from '@src/contracts/appMenu'
import { commandsValueSpec } from '@src/contracts/commands'
import { fileSystemService } from '@src/contracts/fileSystem'
import { fileWatcherService } from '@src/contracts/fileWatcher'
import { fsOperationQueueService } from '@src/contracts/fsOperations'
import { keybindingsValueSpec } from '@src/contracts/keybindings'
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

  const location = computed<AppLocation | null>(() => {
    const section = settings.openSection.value
    return section === null ? null : { kind: 'settings', section }
  })

  return {
    model: settings,
    item: defineRuntimeRegistryItem({
      id: 'settings',
      dispose: () => settings.dispose(),
      providesServices: [
        provideService(settingsService, settings),
        provideService(userSettingsStoreService, store),
      ],
      provides: [
        provide(overlaysValueSpec, {
          id: 'settings',
          order: 10,
          render: () => <SettingsDialog level={level} />,
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
          combo: 'Mod+,',
          commandId: 'settings.open',
          allowInTextInput: true,
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
