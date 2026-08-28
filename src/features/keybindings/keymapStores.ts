import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type { KeymapStore } from '@src/contracts/keybindings'
import type { DesktopBridge } from '@src/desktop/preload'

const BROWSER_STORAGE_KEY = 'zds.keymap'

/**
 * The desktop store: `keybindings.toml` in the app's configuration directory.
 *
 * Beside `user.toml`, and pinned in the main process the same way — the renderer
 * asks for "the keymap", never for a path. A file rather than browser storage
 * because the point of a keymap document is that someone can open it, read the
 * whole of their keyboard in one screen, and edit it with a text editor.
 *
 * Not watched: an edit made outside the app lands on the next launch. Watching
 * it would need the echo-filtering the settings watcher does, and a keymap is
 * changed rarely enough that a restart is a fair price for not building that
 * twice.
 */
export function createDesktopKeymapStore(bridge: DesktopBridge): KeymapStore {
  const location = signal('keybindings.toml')

  // For display only, so nothing waits on it.
  void bridge
    .keymapPath()
    .then((path) => {
      location.value = path
    })
    .catch(() => {
      // A keymap we cannot name is still a keymap we can read and write.
    })

  return {
    id: 'desktop',
    location: computed(() => location.value),
    read: () => bridge.readKeymap(),
    write: (text) => bridge.writeKeymap(text),
  }
}

/**
 * The web store: TOML text in browser storage.
 *
 * TOML rather than JSON, so it is the same document the desktop writes and
 * someone can paste it into `keybindings.toml` and have it work.
 */
export function createBrowserKeymapStore(): KeymapStore {
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
        // Private browsing refuses storage, so the keymap lasts for the session.
        return null
      }
    },
    write: async (text) => {
      try {
        localStorage.setItem(BROWSER_STORAGE_KEY, text)
      } catch (caught) {
        throw new Error(
          `This browser refused to store your keymap: ${String(caught)}`
        )
      }
    },
  }
}
