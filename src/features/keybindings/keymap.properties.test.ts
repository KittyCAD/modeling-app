import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  BASE_SCOPE,
  type Keybinding,
  type KeybindingScope,
} from '@src/contracts/keybindings'
import {
  buildKeymapTree,
  chordFromEvent,
  displayChord,
  effectiveScopes,
  matchKeystrokes,
  normaliseChord,
} from '@src/features/keybindings/keymap'
import { chordKey, MODIFIER_SPELLINGS } from '@src/test/properties'

/**
 * The keymap, as the guarantees it makes to whoever writes a binding.
 *
 * `keymap.ts` says every sharp edge in it "is a bug somebody hit rather than a
 * case somebody imagined". That is the argument for property testing it: the
 * next one will also be a case nobody imagined, and the input space here is
 * enumerable in a way most are not — a handful of modifiers, their aliases, and
 * an order that is not supposed to matter.
 *
 * The costly failure is silence. A binding that never fires because its author
 * wrote `Shift+Mod+1` looks exactly like a keyboard that is broken.
 */

const MODIFIERS = Object.keys(MODIFIER_SPELLINGS)

/** A modifier set and a key, plus two independent ways of writing them down. */
const spelledChord = fc
  .uniqueArray(fc.constantFrom(...MODIFIERS), { maxLength: 3 })
  .chain((modifiers) =>
    fc.record({
      modifiers: fc.constant(modifiers),
      key: chordKey,
      // Two spellings of one chord: different aliases, different casing,
      // different order. The keymap's central claim is that these compare equal.
      spellings: fc.tuple(
        spellingOf(modifiers),
        spellingOf(modifiers),
        spellingOf(modifiers)
      ),
    })
  )

function spellingOf(modifiers: readonly string[]) {
  return fc
    .tuple(
      ...modifiers.map((modifier) =>
        fc.constantFrom(...MODIFIER_SPELLINGS[modifier])
      )
    )
    .chain((written) =>
      // A permutation: min and max at the full length means nothing is dropped,
      // only reordered.
      fc.shuffledSubarray(written, {
        minLength: written.length,
        maxLength: written.length,
      })
    )
}

const write = (modifiers: readonly string[], key: string) =>
  [...modifiers, key].join('+')

describe('chord properties', () => {
  it('is idempotent, so a normalised chord is a stable map key', () => {
    fc.assert(
      fc.property(spelledChord, ({ spellings, key }) => {
        const once = normaliseChord(write(spellings[0], key))
        expect(normaliseChord(once)).toBe(once)
      })
    )
  })

  /**
   * The claim the whole module rests on: alias, casing and modifier order are
   * spelling, not meaning. `Shift+Cmd+K`, `meta+shift+k` and `CMD+Shift+K` are
   * one chord.
   */
  it('gives every spelling of one chord the same normal form', () => {
    fc.assert(
      fc.property(spelledChord, ({ spellings, key }) => {
        const forms = spellings.map((spelling) =>
          normaliseChord(write(spelling, key))
        )
        expect(new Set(forms).size).toBe(1)
      })
    )
  })

  it('writes the modifiers in one order, lowercase, with the key last', () => {
    const order = ['mod', 'meta', 'ctrl', 'alt', 'shift']

    fc.assert(
      fc.property(spelledChord, ({ spellings, key }) => {
        const parts = normaliseChord(write(spellings[0], key)).split('+')

        expect(parts.at(-1)).toBe(key)
        expect(parts).toEqual(parts.map((part) => part.toLowerCase()))
        expect(new Set(parts).size).toBe(parts.length)

        const positions = parts
          .slice(0, -1)
          .map((modifier) => order.indexOf(modifier))
        expect(positions).toEqual([...positions].sort((a, b) => a - b))
      })
    )
  })

  /**
   * Two spellings that mean different chords must stay different. Without this,
   * a normaliser that returned `''` for everything would satisfy the properties
   * above.
   */
  it('keeps different chords different', () => {
    fc.assert(
      fc.property(spelledChord, spelledChord, (left, right) => {
        const same =
          left.key === right.key &&
          new Set(left.modifiers).size === new Set(right.modifiers).size &&
          left.modifiers.every((modifier) => right.modifiers.includes(modifier))
        if (same) return

        expect(normaliseChord(write(left.spellings[0], left.key))).not.toBe(
          normaliseChord(write(right.spellings[0], right.key))
        )
      })
    )
  })

  /** Whatever a spelling looked like, it displays as one thing. */
  it('displays every spelling of one chord identically', () => {
    fc.assert(
      fc.property(spelledChord, fc.boolean(), ({ spellings, key }, isApple) => {
        const shown = spellings.map((spelling) =>
          displayChord(write(spelling, key), isApple)
        )
        expect(new Set(shown).size).toBe(1)
        // Apple writes ⌘⇧K, not ⌘+⇧+K. A `+` on macOS is the tell that a
        // keyboard shortcut was rendered by something that is not a Mac app.
        if (isApple) expect(shown[0]).not.toContain('+')
      })
    )
  })
})

describe('chordFromEvent properties', () => {
  const keyEvent = (fields: Partial<KeyboardEvent>) => ({
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    code: '',
    key: '',
    ...fields,
  })

  /**
   * `Mod` exists so one binding covers both platforms. That is only true if
   * Command on a Mac and Control elsewhere produce the *same* chord — which is
   * the property, and it is not visible from either platform alone.
   */
  it('resolves Mod to the same chord on both platforms', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('a', 'k', 'p'),
        fc.boolean(),
        (key, shift) => {
          const apple = chordFromEvent(
            keyEvent({ key, metaKey: true, shiftKey: shift }),
            true
          )
          const other = chordFromEvent(
            keyEvent({ key, ctrlKey: true, shiftKey: shift }),
            false
          )

          expect(apple).toBe(other)
          expect(apple).toBe(
            normaliseChord(shift ? `mod+shift+${key}` : `mod+${key}`)
          )
        }
      )
    )
  })

  /**
   * Whatever comes out of an event has to be comparable with what came out of a
   * keymap file, and the keymap file's side is normalised. A chord that is not
   * already in normal form matches nothing.
   */
  it('produces chords that are already in normal form', () => {
    fc.assert(
      fc.property(
        fc.record({
          key: fc.constantFrom('a', 'K', '!', 'Escape', ' ', 'ArrowUp'),
          code: fc.constantFrom('', 'KeyA', 'Digit1', 'Slash', 'Space'),
          altKey: fc.boolean(),
          ctrlKey: fc.boolean(),
          metaKey: fc.boolean(),
          shiftKey: fc.boolean(),
        }),
        fc.boolean(),
        (fields, isApple) => {
          const chord = chordFromEvent(keyEvent(fields), isApple)
          if (chord === null) return
          expect(normaliseChord(chord)).toBe(chord)
        }
      )
    )
  })

  it('has nothing to say about a modifier pressed on its own', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('Alt', 'Control', 'Meta', 'Shift'),
        fc.boolean(),
        (key, isApple) => {
          expect(chordFromEvent(keyEvent({ key }), isApple)).toBeNull()
        }
      )
    )
  })
})

describe('effectiveScopes properties', () => {
  const scopeId = fc.constantFrom(
    'editor',
    'sketch',
    'palette',
    'dialog',
    'base'
  )
  const definitions = fc.array(
    fc.record({
      id: scopeId,
      displayName: fc.constant('scope'),
      priority: fc.integer({ min: -5, max: 5 }),
    }),
    { maxLength: 5 }
  )

  /**
   * Three claims, and together they are what makes "the strongest active scope
   * wins" a well-defined statement rather than a hope: the list is ordered by
   * priority, `base` is always present and always weakest, and no scope appears
   * twice — a duplicate would let one scope be consulted before another that
   * outranks it.
   */
  it('is ordered weakest first, deduplicated, and always includes base', () => {
    fc.assert(
      fc.property(fc.array(scopeId), definitions, (active, defined) => {
        const ordered = effectiveScopes(active, defined)
        const priorities = new Map<string, number>(
          defined.map((scope) => [scope.id, scope.priority])
        )

        expect(ordered[0]).toBe(BASE_SCOPE)
        expect(new Set(ordered).size).toBe(ordered.length)
        expect(new Set(ordered)).toEqual(new Set([BASE_SCOPE, ...active]))

        const weights = ordered.slice(1).map((id) => priorities.get(id) ?? 0)
        expect(weights).toEqual([...weights].sort((a, b) => a - b))
      })
    )
  })

  /**
   * Equal priority breaks on the order scopes were applied, most recent last —
   * the rule a stack of contexts would give. Without it, two features that both
   * declared priority 0 would win by contribution order, which is to say at
   * random.
   */
  it('breaks ties in favour of the most recently applied scope', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.constantFrom('editor', 'sketch', 'palette', 'dialog'),
          {
            minLength: 2,
          }
        ),
        (active) => {
          const ordered = effectiveScopes(
            active,
            active.map((id) => ({ id, displayName: id, priority: 0 }))
          )
          expect(ordered).toEqual([BASE_SCOPE, ...active])
        }
      )
    )
  })
})

describe('keymap tree properties', () => {
  /**
   * A set of bindings whose sequences are prefix-free, built by giving each a
   * distinct first chord.
   *
   * Prefix-free on purpose: with `a` and `a b` both bound, `a` is legitimately a
   * full match *and* a prefix, and which one wins is a scope question rather than
   * a tree question. Keeping the shapes apart keeps each property about one
   * thing.
   */
  const bindingSet = fc
    .uniqueArray(chordKey, { minLength: 1, maxLength: 4 })
    .chain((firstChords) =>
      fc.tuple(
        ...firstChords.map((first) =>
          fc.array(chordKey, { maxLength: 2 }).map((tail) => [first, ...tail])
        )
      )
    )
    .map((sequences) =>
      sequences.map((keystrokes, index) => ({
        keystrokes,
        commandId: `command.${index}`,
      }))
    )

  it('matches every binding it was built from', () => {
    fc.assert(
      fc.property(bindingSet, (bindings) => {
        const tree = buildKeymapTree(bindings)

        for (const binding of bindings) {
          const match = matchKeystrokes(tree, binding.keystrokes, [BASE_SCOPE])
          expect(match.type).toBe('full')
          if (match.type === 'full') {
            expect(match.binding.commandId).toBe(binding.commandId)
          }
        }
      })
    )
  })

  /**
   * The state that makes chords possible. Every incomplete sequence has to
   * report `prefix` rather than `none`, because `none` is what flushes the
   * pending chords and gives the keystroke back to the browser.
   */
  it('reports every incomplete sequence as a prefix', () => {
    fc.assert(
      fc.property(bindingSet, (bindings) => {
        const tree = buildKeymapTree(bindings)

        for (const binding of bindings) {
          for (
            let length = 1;
            length < binding.keystrokes.length;
            length += 1
          ) {
            expect(
              matchKeystrokes(tree, binding.keystrokes.slice(0, length), [
                BASE_SCOPE,
              ]).type
            ).toBe('prefix')
          }
        }
      })
    )
  })

  it('reports a sequence it does not hold as no match', () => {
    fc.assert(
      fc.property(
        bindingSet,
        fc.array(chordKey, { minLength: 1, maxLength: 3 }),
        (bindings, attempt) => {
          const tree = buildKeymapTree(bindings)
          const bound = new Set(
            bindings.flatMap((binding) =>
              binding.keystrokes.map((_, at) =>
                binding.keystrokes.slice(0, at + 1).join(' ')
              )
            )
          )
          if (bound.has(attempt.join(' '))) return

          expect(matchKeystrokes(tree, attempt, [BASE_SCOPE]).type).toBe('none')
        }
      )
    )
  })

  /**
   * The invariant end to end: a binding written one way is matched by a
   * keystroke spelled another way. Both halves normalise, and this is the test
   * that they normalise to the *same* thing — the failure mode is a binding that
   * simply never fires.
   */
  it('matches a binding however either side spelled the chord', () => {
    fc.assert(
      fc.property(spelledChord, ({ spellings, key }) => {
        const bindings: Keybinding[] = [
          { keystrokes: [write(spellings[0], key)], commandId: 'command.one' },
        ]
        const tree = buildKeymapTree(bindings)

        const match = matchKeystrokes(
          tree,
          [write(spellings[1], key)],
          [BASE_SCOPE]
        )
        expect(match.type).toBe('full')
      })
    )
  })

  /**
   * Scope priority decides a contested sequence, which is what lets the code
   * editor claim a key the app also uses without either knowing about the other.
   * Generated over priorities because the ordering is the whole mechanism.
   */
  it('gives a contested sequence to the strongest active scope', () => {
    fc.assert(
      fc.property(
        chordKey,
        fc.integer({ min: -5, max: 5 }),
        fc.integer({ min: -5, max: 5 }),
        (key, weakPriority, strongPriority) => {
          if (weakPriority === strongPriority) return

          const scopes: KeybindingScope[] = [
            { id: 'app', displayName: 'App', priority: weakPriority },
            { id: 'editor', displayName: 'Editor', priority: strongPriority },
          ]
          const winner =
            strongPriority > weakPriority ? 'command.editor' : 'command.app'

          const tree = buildKeymapTree([
            { keystrokes: [key], commandId: 'command.app', scopes: ['app'] },
            {
              keystrokes: [key],
              commandId: 'command.editor',
              scopes: ['editor'],
            },
          ])

          const match = matchKeystrokes(tree, [key], ['app', 'editor'], scopes)
          expect(match.type).toBe('full')
          if (match.type === 'full') {
            expect(match.binding.commandId).toBe(winner)
          }
        }
      )
    )
  })

  /**
   * A binding whose scope is not active is not a binding. Otherwise a sketch-only
   * key would fire from the home screen, which is the kind of bug that gets
   * reported as data loss.
   */
  it('ignores a binding whose scope is not active', () => {
    fc.assert(
      fc.property(chordKey, (key) => {
        const tree = buildKeymapTree([
          {
            keystrokes: [key],
            commandId: 'command.sketch',
            scopes: ['sketch'],
          },
        ])

        expect(matchKeystrokes(tree, [key], [BASE_SCOPE]).type).toBe('none')
        expect(matchKeystrokes(tree, [key], ['sketch']).type).toBe('full')
      })
    )
  })
})
