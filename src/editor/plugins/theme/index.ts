import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Annotation, Compartment, StateEffect } from '@codemirror/state'
import { tags } from '@lezer/highlight'
import { SKETCH_SELECTION_RGB_STR } from '@src/lib/constants'
import { EditorView } from 'codemirror'

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
const codeMirrorSelectionBackground = `rgb(${SKETCH_SELECTION_RGB_STR}, 0.5)`
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
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      {
        backgroundColor: codeMirrorSelectionBackground,
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
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      {
        backgroundColor: codeMirrorSelectionBackground,
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
  light: [lightTheme, syntaxHighlighting(baseKclHighlights)],
  dark: [darkTheme, syntaxHighlighting(darkKclHighlights)],
}

/**
 * The visual (background/selection) theme only, without the KCL syntax
 * highlighter. Non-KCL editors — e.g. the plain-text/Markdown code pane — want
 * the light/dark look but must not register the KCL {@link HighlightStyle},
 * because CodeMirror resolves highlighters all-or-nothing: a KCL "main"
 * highlighter would suppress any other (e.g. Markdown) highlight style layered
 * on top of it.
 */
export const editorVisualTheme = {
  light: lightTheme,
  dark: darkTheme,
}

// Markdown highlighting for the plain-text code pane. We can't reuse
// CodeMirror's `defaultHighlightStyle` because its colors are tuned for a light
// background and are unreadable on our dark theme. Instead, we mirror the KCL
// theme's approach: palette-based colors with a dark override. A rule on the
// base `heading` tag cascades to `heading1`–`heading6`.
const baseMarkdownHighlights = HighlightStyle.define([
  { tag: tags.heading, color: colors.primary.light, fontWeight: 'bold' },
  { tag: tags.strong, color: colors.textDefault.light, fontWeight: 'bold' },
  { tag: tags.emphasis, color: colors.textDefault.light, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: colors.primary.light, textDecoration: 'underline' },
  { tag: tags.url, color: colors.primary.light },
  { tag: tags.monospace, color: colors.green.light },
  { tag: tags.list, color: colors.orange.light },
  { tag: tags.quote, color: colors.textFaded.light, fontStyle: 'italic' },
  {
    tag: tags.contentSeparator,
    color: colors.textFaded.light,
    fontWeight: 'bold',
  },
  {
    tag: [tags.processingInstruction, tags.labelName],
    color: colors.textFaded.light,
  },
  { tag: tags.comment, color: colors.textFaded.light, fontStyle: 'italic' },
])

const darkMarkdownHighlights = HighlightStyle.define(
  [
    ...baseMarkdownHighlights.specs,
    { tag: tags.heading, color: colors.primary.dark, fontWeight: 'bold' },
    { tag: tags.strong, color: colors.textDefault.dark, fontWeight: 'bold' },
    { tag: tags.emphasis, color: colors.textDefault.dark, fontStyle: 'italic' },
    { tag: tags.link, color: colors.primary.dark, textDecoration: 'underline' },
    { tag: tags.url, color: colors.primary.dark },
    { tag: tags.monospace, color: colors.green.dark },
    { tag: tags.list, color: colors.orange.dark },
    { tag: tags.quote, color: colors.textFaded.dark, fontStyle: 'italic' },
    {
      tag: tags.contentSeparator,
      color: colors.textFaded.dark,
      fontWeight: 'bold',
    },
    {
      tag: [tags.processingInstruction, tags.labelName],
      color: colors.textFaded.dark,
    },
    { tag: tags.comment, color: colors.textFaded.dark, fontStyle: 'italic' },
  ],
  { themeType: 'dark' }
)

/**
 * Theme-aware Markdown highlight styles for {@link editorVisualTheme}. Keyed by
 * resolved theme so the correct palette loads; the dark style is gated on
 * `EditorView.darkTheme`, so it only takes effect when the dark visual theme is
 * also active.
 */
export const editorMarkdownHighlight = {
  light: syntaxHighlighting(baseMarkdownHighlights),
  dark: syntaxHighlighting(darkMarkdownHighlights),
}
/** Compartment to allow us to reconfigure CodeMirror's theme dynamically outside of React */
export const themeCompartment = new Compartment()

/** Annotation to flag CodeMirror transactions as coming from an app settings update */
export const settingsUpdateAnnotation = Annotation.define<null>()

/** StateEffect to dispatch to CodeMirror when the app theme setting changes */
export const appSettingsThemeEffect = StateEffect.define<'light' | 'dark'>()
/** StateEffect to dispatch to CodeMirror when the app blinkingCursor setting changes */
export const appSettingsBlinkingCursorEffect = StateEffect.define<boolean>()
