import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import {
  Annotation,
  Compartment,
  type Extension,
  StateEffect,
} from '@codemirror/state'
import { tags } from '@lezer/highlight'
import { EditorView } from 'codemirror'
import { Themes } from '@src/lib/theme'

export const normalizeLineEndings = (str: string, normalized = '\n') => {
  return str.replace(/\r?\n/g, normalized)
}

/**
 * GOTCHA: string comparison is hard! Only use this when comparing two code strings
 * so that if we discover we're doing it wrong we only need to change this function.
 *
 * We use it right now to verify an OS file system "change" event isn't already known
 * about by our in-memory kclManager.
 */
export function isCodeTheSame(left: string, right: string) {
  const leftBasis = normalizeLineEndings(left)
  const rightBasis = normalizeLineEndings(right)
  // any other future logic that we failed to implement that causes a bug
  return leftBasis === rightBasis
}

const green = {
  light: 'oklch(from var(--primary) calc(l - 0.1) calc(c) calc(h - 90))',
  dark: 'oklch(from var(--primary) calc(l + 0.1) c calc(h - 90))',
}
const orange = {
  light: 'oklch(from var(--primary) calc(l + 0.05) calc(c + .1) calc(h - 180))',
  dark: 'oklch(from var(--primary) calc(l + 0.25) calc(c + .1) calc(h - 180))',
}
const textDefault = {
  light: 'var(--chalkboard-100)',
  dark: 'var(--chalkboard-20)',
}
const textFaded = {
  light: 'var(--chalkboard-70)',
  dark: 'var(--chalkboard-30)',
}
const magenta = {
  light: 'oklch(from var(--primary) calc(l + 0.05) c calc(h + 90))',
}
const primary = {
  light: 'var(--primary)',
  dark: 'oklch(from var(--primary) calc(l + 0.15) c h)',
}
const colors = {
  green,
  magenta,
  orange,
  primary,
  textDefault,
  textFaded,
}
const baseKclHighlights = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.annotation],
    color: colors.orange.light,
  },
  {
    tag: [tags.number, tags.string, tags.tagName],
    color: colors.green.light,
    fontWeight: 'normal',
  },
  {
    tag: [tags.attributeName, tags.definition(tags.propertyName)],
    color: colors.magenta.light,
    fontWeight: 'normal',
  },
  { tag: tags.function(tags.variableName), color: colors.textDefault.light },
  {
    tag: tags.definitionKeyword,
    backgroundColor: 'oklch(from var(--primary) calc(l + 0.05) c h / .1)',
    color: colors.primary.light,
    borderRadius: '2px',
  },
  { tag: [tags.variableName], color: colors.primary.light },
  { tag: tags.comment, color: colors.textFaded.light, fontStyle: 'italic' },
  {
    tag: tags.definition(tags.variableName),
    color: colors.textFaded.light,
    fontWeight: 'bold',
  },
  { tag: tags.controlOperator, color: colors.textFaded.light },
  {
    tag: [tags.paren, tags.brace, tags.bracket],
    color: colors.textFaded.light,
    fontWeight: 'bold',
  },
])

const darkKclHighlights = HighlightStyle.define(
  [
    ...baseKclHighlights.specs,
    {
      tag: [tags.keyword, tags.annotation],
      color: colors.orange.dark,
    },
    {
      tag: tags.definitionKeyword,
      backgroundColor: 'oklch(from var(--primary) calc(l + 0.25) c h / .2)',
      color: colors.primary.dark,
    },
    { tag: tags.function(tags.variableName), color: colors.textDefault.dark },
    {
      tag: [tags.variableName],
      color: colors.primary.dark,
    },
    {
      tag: [tags.number, tags.string, tags.tagName],
      color: colors.green.dark,
      fontWeight: 'normal',
    },
    { tag: tags.comment, color: 'var(--chalkboard-30)', fontStyle: 'italic' },
    {
      tag: tags.definition(tags.variableName),
      color: 'var(--chalkboard-30)',
      fontWeight: 'bold',
    },
    { tag: tags.atom, color: 'var(--chalkboard-40)' },
    { tag: tags.controlOperator, color: 'var(--chalkboard-30)' },
    {
      tag: [tags.paren, tags.brace, tags.bracket],
      color: 'var(--chalkboard-30)',
      fontWeight: 'bold',
    },
  ],
  {
    themeType: 'dark',
  }
)

const lightTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: '#fff',
    },
  },
  {
    dark: false,
  }
)
const darkTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',
    },
  },
  {
    dark: true,
  }
)

/**
 * Nearly-empty themes that just mark themselves as light or dark
 * so our {@link syntaxHighlightingExtension} can apply its styling.
 */
export const editorTheme = {
  [Themes.Light]: [lightTheme, syntaxHighlighting(baseKclHighlights)],
  [Themes.Dark]: [darkTheme, syntaxHighlighting(darkKclHighlights)],
} satisfies Record<Exclude<Themes, 'system'>, Extension>
/** Compartment to allow us to reconfigure CodeMirror's theme dynamically outside of React */
export const themeCompartment = new Compartment()

/** Annotation to flag CodeMirror transactions as coming from an app settings update */
export const settingsUpdateAnnotation = Annotation.define<null>()

/** StateEffect to dispatch to CodeMirror when the app theme setting changes */
export const appSettingsThemeEffect = StateEffect.define<'light' | 'dark'>()
/** StateEffect to dispatch to CodeMirror when the app blinkingCursor setting changes */
export const appSettingsBlinkingCursorEffect = StateEffect.define<boolean>()
