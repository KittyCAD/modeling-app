const CODEMIRROR_PRINTABLE_KEYSTROKES_MESSAGE =
  'Keymap items active while the code editor is focused must not start with a text-producing chord. Use the code-editor-not-focused scope for text-producing shortcuts that should only run outside the editor.'

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

const isEditorActiveScope = (node) =>
  node.type === 'Literal' &&
  (node.value === 'base' || node.value === 'code-editor-focused')

const isEditorActiveKeymap = (node) => {
  const scopes = getObjectProperty(node, 'scopes')
  if (!scopes) {
    return true
  }

  if (scopes.value.type === 'ArrayExpression') {
    return scopes.value.elements.some(
      (element) => element && isEditorActiveScope(element)
    )
  }

  return false
}

const getFirstKeystrokesChord = (node) => {
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
      textProducingCodeMirrorKeystrokes:
        CODEMIRROR_PRINTABLE_KEYSTROKES_MESSAGE,
    },
    schema: [],
  },
  create(context) {
    return {
      ObjectExpression(node) {
        if (!isEditorActiveKeymap(node)) {
          return
        }

        const keystrokes = getObjectProperty(node, 'keystrokes')
        if (!keystrokes) {
          return
        }

        const firstChord = getFirstKeystrokesChord(keystrokes.value)
        if (!firstChord || !chordProducesText(firstChord)) {
          return
        }

        context.report({
          node: keystrokes.value,
          messageId: 'textProducingCodeMirrorKeystrokes',
        })
      },
    }
  },
}

export default rule
