const CODEMIRROR_PRINTABLE_SEQUENCE_MESSAGE =
  'CodeMirror keymap items must not start with a text-producing chord. Use registerToCodeMirror only for shortcut chords with a non-text modifier.'

const NON_TEXT_MODIFIERS = new Set([
  'cmd',
  'command',
  'control',
  'ctrl',
  'meta',
  'mod',
])

const TEXT_KEY_NAMES = new Set(['space', 'spacebar'])

const NON_TEXT_KEY_NAMES = new Set([
  'arrowdown',
  'arrowleft',
  'arrowright',
  'arrowup',
  'backspace',
  'capslock',
  'delete',
  'end',
  'enter',
  'escape',
  'esc',
  'home',
  'insert',
  'pagedown',
  'pageup',
  'tab',
])

const getPropertyName = (property) => {
  if (property.key.type === 'Identifier') {
    return property.key.name
  }
  if (
    property.key.type === 'Literal' &&
    typeof property.key.value === 'string'
  ) {
    return property.key.value
  }
  return undefined
}

const getObjectProperty = (node, name) =>
  node.properties.find(
    (property) =>
      property.type === 'Property' &&
      !property.computed &&
      getPropertyName(property) === name
  )

const isTrueLiteral = (node) => node.type === 'Literal' && node.value === true

const getFirstSequenceChord = (node) => {
  if (node.type !== 'ArrayExpression') {
    return undefined
  }

  const firstElement = node.elements[0]
  if (
    !firstElement ||
    firstElement.type !== 'Literal' ||
    typeof firstElement.value !== 'string'
  ) {
    return undefined
  }

  return firstElement.value
}

export const chordProducesText = (chord) => {
  const chordParts = chord
    .toLowerCase()
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)

  if (chordParts.some((part) => NON_TEXT_MODIFIERS.has(part))) {
    return false
  }

  const key = chordParts.at(-1)
  if (!key || NON_TEXT_KEY_NAMES.has(key)) {
    return false
  }

  return key.length === 1 || TEXT_KEY_NAMES.has(key)
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow CodeMirror keymap registrations that start with text-producing chords.',
    },
    messages: {
      textProducingCodeMirrorSequence: CODEMIRROR_PRINTABLE_SEQUENCE_MESSAGE,
    },
    schema: [],
  },
  create(context) {
    return {
      ObjectExpression(node) {
        const registerToCodeMirror = getObjectProperty(
          node,
          'registerToCodeMirror'
        )
        if (
          !registerToCodeMirror ||
          !isTrueLiteral(registerToCodeMirror.value)
        ) {
          return
        }

        const sequence = getObjectProperty(node, 'sequence')
        if (!sequence) {
          return
        }

        const firstChord = getFirstSequenceChord(sequence.value)
        if (!firstChord || !chordProducesText(firstChord)) {
          return
        }

        context.report({
          node: sequence.value,
          messageId: 'textProducingCodeMirrorSequence',
        })
      },
    }
  },
}

export default rule
