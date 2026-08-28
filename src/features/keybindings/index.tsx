import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals'
import { useService } from '@src/app/context'
import { commandService } from '@src/contracts/commands'
import {
  BASE_SCOPE,
  type KeybindingService,
  type PersistedKeymap,
  keybindingScopesValueSpec,
  keybindingService,
  keybindingsValueSpec,
} from '@src/contracts/keybindings'
import { settingsSectionsValueSpec } from '@src/contracts/settings'
import { statusBarItemsValueSpec } from '@src/contracts/shell'
import { KeybindingsTable } from '@src/features/keybindings/KeybindingsTable'
import { createKeymapDispatcher } from '@src/features/keybindings/createKeymapDispatcher'
import {
  createBrowserKeymapStore,
  createDesktopKeymapStore,
} from '@src/features/keybindings/keymapStores'
import {
  displayKeystrokes,
  findBindingForCommand,
} from '@src/features/keybindings/keymap'
import {
  emptyKeymap,
  parseKeymap,
  resolveBindings,
  serialiseKeymap,
  withRebind,
  withUnbind,
  withoutCommand,
} from '@src/features/keybindings/persistedKeymap'
import './keybindings.css'

/** What has been typed so far, while it is not yet an answer. */
function PendingChord() {
  const keys = useService(keybindingService)

  return (
    <span class="zds-status-field zds-pending-chord">
      <span class="zds-status-field__name">keys</span>
      <span class="zds-status-field__value">
        {displayKeystrokes(keys.pending.value)}
        <span class="zds-pending-chord__caret">…</span>
      </span>
    </span>
  )
}

/**
 * Dispatches keystrokes to commands.
 *
 * One listener for the whole app, on the capture phase so a binding is not
 * swallowed by whatever holds focus. Three things the shape buys, none of which
 * was true of the flat combo-to-command map it replaced:
 *
 * - **Sequences.** `['v', '1']` is a binding, and a keystroke that only matches
 *   the start of one is a state rather than a miss. The pending chords go in the
 *   status bar, because a keyboard that has silently eaten a keystroke while it
 *   waits for another is indistinguishable from one that is broken.
 * - **Scopes.** A feature declares the situation it cares about and applies it
 *   when it knows it is true. The strongest active scope wins a contested
 *   sequence, so the code editor can claim a key the app also uses without
 *   either of them knowing about the other.
 * - **Bare keys belong to whoever is typing.** The old rule dropped every
 *   unflagged binding while focus sat in a text field, which silently killed
 *   `⌘1` the moment the editor had focus. Now a modified chord always
 *   dispatches, and only unmodified keys defer.
 */
export default defineRegistryItemFactory((ctx) => {
  const contributed = computed(() => ctx.valueSpecs.get(keybindingsValueSpec))
  const scopes = computed(() => ctx.valueSpecs.get(keybindingScopesValueSpec))

  // Chosen from the bridge rather than the runtime service, as in settings: this
  // runs during graph construction, where resolving a service is not allowed.
  const store =
    typeof window !== 'undefined' && window.electron
      ? createDesktopKeymapStore(window.electron)
      : createBrowserKeymapStore()

  const persisted = signal<PersistedKeymap>(emptyKeymap())

  /**
   * The keymap the app actually dispatches from.
   *
   * A `computed`, so the user's file and a feature appearing or disappearing are
   * the same kind of event: something changed, and the tree is rebuilt from
   * whatever the answer is now.
   */
  const bindings = computed(() =>
    resolveBindings(contributed.value, persisted.value)
  )

  /**
   * Read the stored keymap once, on the way up.
   *
   * Deliberately not awaited by anything. A keystroke pressed in the first
   * moments uses the app's defaults, which is the right answer if we do not yet
   * know of an override — and a keymap that has to load before the keyboard
   * works would be a worse trade.
   */
  const loaded = store
    .read()
    .then((text) => {
      if (text !== null) persisted.value = parseKeymap(text)
    })
    .catch((error) => {
      console.warn('keybindings: could not read the keymap', error)
    })

  const save = async (next: PersistedKeymap) => {
    // Waited for, so a save cannot land before the initial read and then be
    // overwritten by it.
    await loaded
    persisted.value = next
    await store.write(serialiseKeymap(next))
  }

  const dispatcher = createKeymapDispatcher({
    bindings,
    scopes,
    run: (commandId) => ctx.services.get(commandService).run(commandId),
  })

  const onKeyDown = (event: KeyboardEvent) => {
    dispatcher.handleKeyDown(event)
  }

  window.addEventListener('keydown', onKeyDown, { capture: true })

  const service: KeybindingService = {
    bindings,
    contributed,
    persisted: computed(() => persisted.value),
    location: store.location,
    scopes,
    activeScopes: dispatcher.activeScopes,
    pending: dispatcher.pending,
    applyScope: dispatcher.applyScope,
    removeScope: dispatcher.removeScope,
    focusScope: dispatcher.focusScope,
    suspendListening: dispatcher.suspendListening,

    displayFor: (commandId) => {
      const binding = findBindingForCommand(
        bindings.value,
        commandId,
        dispatcher.activeScopes.value,
        scopes.value
      )
      return binding ? displayKeystrokes(binding.keystrokes) : undefined
    },

    save,
    rebind: (commandId, keystrokes, scopeIds) =>
      save(withRebind(persisted.value, commandId, keystrokes, scopeIds)),
    unbind: (commandId) => save(withUnbind(persisted.value, commandId)),
    restore: (commandId) => save(withoutCommand(persisted.value, commandId)),
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'keybindings',
      dispose: () => {
        window.removeEventListener('keydown', onKeyDown, { capture: true })
        dispatcher.dispose()
      },
      providesServices: [provideService(keybindingService, service)],
      provides: [
        /**
         * The scope everything falls into.
         *
         * Contributed like any other so a table has a name for it, and so
         * `base` is not a string whose meaning only the keymap knows.
         */
        provide(keybindingScopesValueSpec, {
          id: BASE_SCOPE,
          displayName: 'Everywhere',
          priority: 0,
        }),

        /**
         * The keyboard, in the settings dialog.
         *
         * A section with a body and no rows: eighty bindings are not eighty
         * settings, and pretending otherwise would make the three-level cascade
         * lie about what it holds. User level only — a keymap is a property of
         * the person, and a project has no business rebinding anyone's keys.
         */
        provide(settingsSectionsValueSpec, {
          id: 'keybindings',
          title: 'Keyboard',
          description:
            'Every command, and the keys that reach it. Changes are written to your own keymap; the app’s defaults stay where they are.',
          icon: 'command',
          order: 40,
          levels: ['user'],
          render: () => <KeybindingsTable />,
        }),

        provide(statusBarItemsValueSpec, {
          id: 'keybindings.pending',
          zone: 'end',
          order: -10,
          visible: computed(() => dispatcher.pending.value.length > 0),
          render: () => <PendingChord />,
        }),
      ],
    }),
  }
}, 'keybindings')
