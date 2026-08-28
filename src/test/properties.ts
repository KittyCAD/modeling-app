import fc from 'fast-check'

/**
 * Arbitraries shared by more than one property test.
 *
 * A property test is only as good as the inputs it draws, and the inputs that
 * find bugs in this app are not random strings: they are text with repeated
 * characters, paths with a `..` in the middle, chords written in the wrong
 * order. Those generators are worth writing once and worth explaining, because
 * a generator that never produces the interesting case makes a test that passes
 * for the wrong reason.
 *
 * Anything used by a single file stays in that file, next to the property it
 * feeds.
 */

/**
 * Text over a three-character alphabet.
 *
 * The most valuable document generator, and the least obvious. Every
 * prefix/suffix and diff-shaped algorithm goes wrong on *repeats* — `aaa` to
 * `aa` is the case that makes a common-suffix scan claim characters the common
 * prefix already claimed — and a generator over the full alphabet almost never
 * draws two adjacent equal characters. Three symbols, one of them a newline,
 * collide constantly.
 */
export const repetitiveText = fc.string({
  unit: fc.constantFrom('a', 'b', '\n'),
  maxLength: 40,
})

/**
 * Text that is not ASCII, and not one code unit per character.
 *
 * `binary` draws the whole Unicode range, so a string can hold astral
 * characters that are two UTF-16 code units and four UTF-8 bytes. Anything that
 * measures a string in one unit and indexes it in another fails here and
 * nowhere else.
 */
export const unicodeText = fc.string({ unit: 'binary', maxLength: 30 })

const kclLines = fc
  .array(
    fc.constantFrom(
      'sketch001 = startSketchOn(XY)\n',
      'width = 10\n',
      'depth = 2\n',
      '// a comment\n',
      'extrude(sketch001, length = 5)\n',
      '\n'
    ),
    { maxLength: 8 }
  )
  .map((lines) => lines.join(''))

/** Document contents: mostly repetitive, sometimes KCL-ish, sometimes not ASCII. */
export const documentText = fc.oneof(
  { weight: 5, arbitrary: repetitiveText },
  { weight: 2, arbitrary: unicodeText },
  { weight: 3, arbitrary: kclLines }
)

/**
 * One path segment, including the ones that are not names.
 *
 * `.` and `..` are in here deliberately: they are the segments a path helper has
 * to interpret rather than carry, and they are the ones a test author forgets.
 * The rest are characters a filesystem allows and a URI, a shell or a regular
 * expression would rather it did not.
 */
export const pathSegment = fc.oneof(
  fc.constantFrom(
    'a',
    'b',
    'projects',
    'main.kcl',
    'my part.kcl',
    '100% scale.kcl',
    'π.kcl',
    'a+b',
    '#hash',
    'q?uery',
    'dot.dot.kcl',
    '.hidden',
    '.',
    '..'
  ),
  fc
    .string({ unit: 'binary', minLength: 1, maxLength: 6 })
    // A segment holding a separator is two segments, and the paths below join
    // with separators themselves — it would quietly generate a different path
    // than the property thinks it is testing.
    .filter((segment) => !segment.includes('/') && !segment.includes('\\'))
)

/** A segment that is only ever a name: no separators, no `.` or `..`. */
export const plainSegment = pathSegment.filter(
  (segment) => segment !== '.' && segment !== '..'
)

/**
 * `/a/b/c`, with the interior separators sometimes doubled or backslashed.
 *
 * The *leading* separator is always a forward slash, because that is what makes
 * a path absolute as far as this app is concerned — everything above the
 * filesystem layer speaks forward slashes, and a path arriving with a leading
 * backslash is a Windows path the filesystem layer should already have
 * normalised. Generating one and then asserting it stays absolute would be
 * testing a claim the code never made.
 */
export const absolutePath = fc
  .array(pathSegment, { minLength: 1, maxLength: 5 })
  .chain((segments) =>
    fc
      .array(fc.constantFrom('/', '//', '\\'), {
        minLength: segments.length,
        maxLength: segments.length,
      })
      .map((separators) =>
        segments
          .map((segment, at) => {
            const separator =
              at === 0 && separators[at] === '\\' ? '/' : separators[at]
            return separator + segment
          })
          .join('')
      )
  )

/** `a/b/c`: the same, without a leading separator or an interpreted segment. */
export const relativePathText = fc
  .array(plainSegment, { minLength: 1, maxLength: 4 })
  // Assembled by hand rather than with `joinPath`, which is one of the things
  // under test: a generator that normalised its own output could only ever
  // produce paths the code already agrees about.
  .map((segments) =>
    segments.reduce((path, segment) => (path ? `${path}/${segment}` : segment))
  )

/** A modifier, in each of the spellings a keymap accepts for it. */
export const MODIFIER_SPELLINGS: Record<string, readonly string[]> = {
  meta: ['meta', 'cmd', 'command', 'super', 'win', 'Meta', 'CMD'],
  ctrl: ['ctrl', 'control', 'Ctrl', 'CONTROL'],
  alt: ['alt', 'option', 'Alt', 'Option'],
  shift: ['shift', 'Shift'],
  mod: ['mod', 'Mod', 'MOD'],
}

/** The non-modifier part of a chord. */
export const chordKey = fc.constantFrom(
  'a',
  'k',
  'p',
  '1',
  '7',
  'escape',
  'enter',
  'space',
  'delete',
  'arrowup',
  '/',
  '['
)

/**
 * A chord as a person might write it: any modifiers, any spelling, any order.
 *
 * The generator exists to attack one claim — that two spellings of the same
 * chord compare equal — so it has to be free to write `Shift+Cmd+K` where the
 * keymap would write `meta+shift+k`.
 */
export const chord = fc
  .uniqueArray(fc.constantFrom(...Object.keys(MODIFIER_SPELLINGS)), {
    maxLength: 3,
  })
  .chain((modifiers) =>
    fc.record({
      modifiers: fc.tuple(
        ...modifiers.map((modifier) =>
          fc.constantFrom(...MODIFIER_SPELLINGS[modifier])
        )
      ),
      key: chordKey,
    })
  )
  .map(({ modifiers, key }) => [...modifiers, key].join('+'))

/** A sequence of chords, which is what a binding is bound to. */
export const keystrokes = fc.array(chord, { minLength: 1, maxLength: 3 })
