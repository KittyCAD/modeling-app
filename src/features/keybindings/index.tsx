import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed } from '@preact/signals'
import { useService } from '@src/app/context'
import { commandService } from '@src/contracts/commands'
import {
  BASE_SCOPE,
  type KeybindingService,
  keybindingScopesValueSpec,
  keybindingService,
  keybindingsValueSpec,
} from '@src/contracts/keybindings'
import { statusBarItemsValueSpec } from '@src/contracts/shell'
import { createKeymapDispatcher } from '@src/features/keybindings/createKeymapDispatcher'
import {
  displayKeystrokes,
  findBindingForCommand,
} from '@src/features/keybindings/keymap'
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
  const bindings = computed(() => ctx.valueSpecs.get(keybindingsValueSpec))
  const scopes = computed(() => ctx.valueSpecs.get(keybindingScopesValueSpec))

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
