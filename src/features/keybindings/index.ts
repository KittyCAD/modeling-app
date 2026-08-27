import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { computed } from '@preact/signals'
import { commandService } from '@src/contracts/commands'
import {
  type Keybinding,
  keybindingService,
  keybindingsValueSpec,
} from '@src/contracts/keybindings'

const isApple =
  typeof navigator !== 'undefined' &&
  /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)

/** Normalise an event into the same shape a `combo` string parses to. */
function comboFromEvent(event: KeyboardEvent): string {
  const parts: string[] = []
  const mod = isApple ? event.metaKey : event.ctrlKey
  const secondaryMod = isApple ? event.ctrlKey : event.metaKey

  if (mod) parts.push('Mod')
  if (secondaryMod) parts.push(isApple ? 'Ctrl' : 'Meta')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')

  // Digits come from `code`, so Shift+1 does not arrive as "!".
  const key = /^Digit\d$/.test(event.code)
    ? event.code.slice(-1)
    : event.key.length === 1
      ? event.key.toUpperCase()
      : event.key

  parts.push(key)
  return parts.join('+')
}

function normalise(combo: string): string {
  return combo
    .split('+')
    .map((part) => part.trim())
    .map((part) => (part.length === 1 ? part.toUpperCase() : part))
    .join('+')
}

/** Turn `Mod+Shift+P` into the platform's own glyphs. */
function display(combo: string): string {
  return combo
    .split('+')
    .map((part) => {
      switch (part) {
        case 'Mod':
          return isApple ? '⌘' : 'Ctrl'
        case 'Shift':
          return isApple ? '⇧' : 'Shift'
        case 'Alt':
          return isApple ? '⌥' : 'Alt'
        case 'Ctrl':
          return isApple ? '⌃' : 'Ctrl'
        default:
          return part
      }
    })
    .join(isApple ? '' : '+')
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * Dispatches keystrokes to commands.
 *
 * One listener for the whole app, on the capture phase so a binding is not
 * swallowed by whatever happens to hold focus. Bindings resolve to command ids
 * and nothing else, so the keyboard cannot reach behaviour that does not
 * already exist as a command.
 */
export default defineRegistryItemFactory((ctx) => {
  const bindings = computed(() =>
    ctx.valueSpecs.get(keybindingsValueSpec).map((binding) => ({
      ...binding,
      combo: normalise(binding.combo),
    }))
  )

  const byCombo = computed(() => {
    const map = new Map<string, Keybinding>()
    for (const binding of bindings.value) {
      if (!map.has(binding.combo)) map.set(binding.combo, binding)
    }
    return map
  })

  const onKeyDown = (event: KeyboardEvent) => {
    const binding = byCombo.value.get(comboFromEvent(event))
    if (!binding) return
    if (!binding.allowInTextInput && isTextEntry(event.target)) return

    event.preventDefault()
    event.stopPropagation()
    ctx.services.get(commandService).run(binding.commandId)
  }

  window.addEventListener('keydown', onKeyDown, { capture: true })

  return {
    item: defineRuntimeRegistryItem({
      id: 'keybindings',
      dispose: () =>
        window.removeEventListener('keydown', onKeyDown, { capture: true }),
      providesServices: [
        provideService(keybindingService, {
          bindings,
          displayFor: (commandId) => {
            const binding = bindings.value.find(
              (candidate) => candidate.commandId === commandId
            )
            return binding ? display(binding.combo) : undefined
          },
        }),
      ],
    }),
  }
}, 'keybindings')
