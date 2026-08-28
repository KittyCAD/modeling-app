import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type {
  Keybinding,
  PersistedBinding,
  PersistedKeymap,
} from '@src/contracts/keybindings'
import {
  boundCommand,
  isUnbind,
  KEYMAP_VERSION,
  resolveBindings,
} from '@src/features/keybindings/persistedKeymap'
import { chord, keystrokes } from '@src/test/properties'

/**
 * Folding the user's keymap into the app's, as the two rules it claims to be.
 *
 * `persistedKeymap.ts` states the model in two sentences — a stored binding for
 * a command replaces every contributed binding for that command, and `-command`
 * removes the command's keys without putting anything back. Two rules over an
 * arbitrary pair of keymaps is precisely the shape a property test is for, and
 * the consequence of getting it wrong is that somebody's keymap file silently
 * does not mean what it says.
 */

const commandId = fc.constantFrom(
  'file.save',
  'file.open',
  'edit.undo',
  'view.front',
  'sketch.line'
)

const contributedBindings = fc.array(
  fc.record<Keybinding>({
    keystrokes,
    commandId,
    scopes: fc.constantFrom(undefined, ['base'], ['editor'], ['sketch']),
  }),
  { maxLength: 6 }
)

/**
 * Stored lines, including the ones a hand-edited file really contains: an
 * unbind, a command with several lines, and the degenerate entries — no
 * keystrokes, an empty command, a bare `-`.
 */
const persistedLine = fc.record<PersistedBinding>({
  command: fc.oneof(
    commandId,
    commandId.map((id) => `-${id}`),
    fc.constantFrom('', '-')
  ),
  keystrokes: fc.oneof(
    keystrokes,
    fc.constant(undefined),
    fc.constant([]),
    fc.array(fc.constantFrom('', ' ')),
    chord.map((one) => [one, ''])
  ),
  scopes: fc.constantFrom(undefined, ['base'], ['editor']),
})

const persistedKeymap = fc
  .array(persistedLine, { maxLength: 6 })
  .map<PersistedKeymap>((bindings) => ({
    version: KEYMAP_VERSION,
    bindings,
  }))

const claimedCommands = (keymap: PersistedKeymap) =>
  new Set(
    keymap.bindings
      .map((line) => boundCommand(line.command))
      .filter((id) => id.length > 0)
  )

describe('resolveBindings properties', () => {
  /**
   * Rule one. Per command rather than per binding, which is the part that is
   * easy to implement as "replace the matching binding" and then leaves a
   * shipped duplicate firing alongside the user's.
   */
  it('leaves no app binding for a command the keymap mentions', () => {
    fc.assert(
      fc.property(
        contributedBindings,
        persistedKeymap,
        (contributed, keymap) => {
          const claimed = claimedCommands(keymap)

          for (const binding of resolveBindings(contributed, keymap)) {
            if (binding.source === 'app') {
              expect(claimed.has(binding.commandId)).toBe(false)
            }
          }
        }
      )
    )
  })

  /**
   * Rule two, and the one with no second chance: an unbind that quietly did
   * nothing would leave a key doing the thing somebody explicitly asked it to
   * stop doing.
   */
  it('leaves nothing at all for an unbound command', () => {
    fc.assert(
      fc.property(
        contributedBindings,
        persistedKeymap,
        (contributed, keymap) => {
          const unbound = new Set(
            keymap.bindings
              .filter((line) => isUnbind(line.command))
              .map((line) => boundCommand(line.command))
              .filter((id) => id.length > 0)
          )
          // A command can be unbound on one line and rebound on another; the
          // rebinding is a stored binding for it, so only the untouched ones are
          // expected to disappear.
          const rebound = new Set(
            keymap.bindings
              .filter((line) => !isUnbind(line.command))
              .map((line) => line.command)
          )

          for (const binding of resolveBindings(contributed, keymap)) {
            if (rebound.has(binding.commandId)) continue
            expect(unbound.has(binding.commandId)).toBe(false)
          }
        }
      )
    )
  })

  /**
   * A command the keymap says nothing about keeps exactly what shipped — same
   * keystrokes, same scopes, same order. This is the property that stops a
   * keymap file from being able to break a binding it never mentioned.
   */
  it('leaves every unmentioned command exactly as it shipped', () => {
    fc.assert(
      fc.property(
        contributedBindings,
        persistedKeymap,
        (contributed, keymap) => {
          const claimed = claimedCommands(keymap)
          const untouched = contributed.filter(
            (binding) => !claimed.has(binding.commandId)
          )

          const resolved = resolveBindings(contributed, keymap)
          expect(
            resolved.filter((binding) => binding.source === 'app')
          ).toEqual(untouched.map((binding) => ({ ...binding, source: 'app' })))
        }
      )
    )
  })

  /**
   * The user's bindings come first so that when somebody takes a chord the app
   * was already using, theirs is the one that fires. Order *is* the resolution
   * rule here, so it is worth asserting rather than assuming.
   */
  it('puts every user binding ahead of every app binding', () => {
    fc.assert(
      fc.property(
        contributedBindings,
        persistedKeymap,
        (contributed, keymap) => {
          const sources = resolveBindings(contributed, keymap).map(
            (binding) => binding.source
          )
          const firstApp = sources.indexOf('app')
          if (firstApp === -1) return

          expect(sources.slice(firstApp)).not.toContain('user')
        }
      )
    )
  })

  /** Every binding carries where it came from, because the dialog prints it. */
  it('attributes every resolved binding to app or user', () => {
    fc.assert(
      fc.property(
        contributedBindings,
        persistedKeymap,
        (contributed, keymap) => {
          for (const binding of resolveBindings(contributed, keymap)) {
            expect(binding.source === 'app' || binding.source === 'user').toBe(
              true
            )
            expect(binding.keystrokes.length).toBeGreaterThan(0)
            // A line with no usable keystrokes is not a binding. Letting one
            // through would put an entry in the tree under no chord at all.
            expect(binding.keystrokes).not.toContain('')
          }
        }
      )
    )
  })

  /**
   * Resolution is a fixed point: applying the keymap to its own result changes
   * nothing. The keymap is re-resolved whenever the file changes or a feature
   * contributes late, so a fold that drifted would drift once per reload.
   */
  it('is a fixed point', () => {
    fc.assert(
      fc.property(
        contributedBindings,
        persistedKeymap,
        (contributed, keymap) => {
          const once = resolveBindings(contributed, keymap)
          expect(resolveBindings(once, keymap)).toEqual(once)
        }
      )
    )
  })
})
