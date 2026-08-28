import { computed, type ReadonlySignal, signal } from '@preact/signals'
import type { SettingsStore } from '@src/contracts/settings'
import type { DesktopBridge } from '@src/desktop/preload'

const BROWSER_STORAGE_KEY = 'zds.settings.user'

/**
 * The desktop store: `user.toml` in the app's configuration directory.
 *
 * The path is pinned in the main process, so this is one of the few filesystem
 * operations that does not go through the granted-roots check — the renderer
 * cannot name the file, only ask for the one file it is allowed.
 */
export function createDesktopUserSettingsStore(
  bridge: DesktopBridge
): SettingsStore {
  const location = signal('user.toml')

  // Resolved for display only, so nothing waits on it.
  void bridge
    .userSettingsPath()
    .then((path) => {
      location.value = path
    })
    .catch(() => {
      // Leave the placeholder; a settings file we cannot name is still a
      // settings file we can read and write.
    })

  return {
    id: 'desktop',
    location: computed(() => location.value),
    read: () => bridge.readUserSettings(),
    write: (text) => bridge.writeUserSettings(text),
  }
}

/**
 * The web store: TOML text in browser storage.
 *
 * Still TOML rather than JSON, so the format is the same one the desktop writes
 * and a setting does not need two codecs. Someone can paste this into a
 * `user.toml` and have it work.
 */
export function createBrowserUserSettingsStore(): SettingsStore {
  const location: ReadonlySignal<string> = computed(
    () => 'this browser’s storage'
  )

  return {
    id: 'browser',
    location,
    read: async () => {
      try {
        return localStorage.getItem(BROWSER_STORAGE_KEY)
      } catch {
        // Private browsing refuses storage. Settings then last for the session,
        // which the dialog says out loud rather than failing silently.
        return null
      }
    },
    write: async (text) => {
      try {
        localStorage.setItem(BROWSER_STORAGE_KEY, text)
      } catch (caught) {
        throw new Error(
          `This browser refused to store your settings: ${String(caught)}`
        )
      }
    },
  }
}
