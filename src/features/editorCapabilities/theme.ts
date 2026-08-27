import { HighlightStyle } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { cssVar, tokens } from '@kittycad/ui-kit/tokens'

/**
 * Syntax colours, drawn from the design tokens.
 *
 * Reading `var(--zds-…)` rather than hard-coding hex means the editor follows a
 * theme change with no JavaScript at all — the same cascade that themes the rest
 * of the app themes the code.
 *
 * The palette is deliberately narrow. Code is the densest text in the app, and
 * a colour per token type turns it into confetti; only the distinctions worth
 * making at a glance get one.
 */
export const zooHighlightStyle = HighlightStyle.define([
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: cssVar(tokens.textColor.tertiary),
    fontStyle: 'italic',
  },
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.modifier,
      tags.operatorKeyword,
    ],
    color: cssVar(tokens.textColor.accent),
  },
  {
    tag: [tags.number, tags.bool, tags.null, tags.unit],
    color: cssVar(tokens.textColor.datum),
  },
  {
    tag: [tags.string, tags.special(tags.string)],
    color: cssVar(tokens.textColor.flag),
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: cssVar(tokens.textColor.primary),
  },
  {
    tag: [tags.propertyName, tags.attributeName],
    color: cssVar(tokens.textColor.secondary),
  },
  {
    tag: [tags.variableName, tags.definition(tags.variableName)],
    color: cssVar(tokens.textColor.primary),
  },
  {
    tag: [tags.operator, tags.punctuation, tags.bracket],
    color: cssVar(tokens.textColor.tertiary),
  },
  {
    tag: [tags.heading],
    color: cssVar(tokens.textColor.primary),
    fontWeight: '600',
  },
  { tag: [tags.link, tags.url], color: cssVar(tokens.textColor.datum) },
  { tag: [tags.invalid], color: cssVar(tokens.textColor.fault) },
])

/**
 * The editor's own chrome.
 *
 * Matches the app's density and seams rather than CodeMirror's defaults: same
 * mono face, same hairlines, and a gutter that reads as part of the panel
 * instead of a separate widget.
 */
export const zooEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontFamily: cssVar(tokens.fontMono),
    fontSize: cssVar(tokens.fontSize.small),
    backgroundColor: cssVar(tokens.surface.panel),
    color: cssVar(tokens.textColor.primary),
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: '1.6',
  },
  '.cm-content': {
    padding: `${cssVar(tokens.space[2])} 0`,
    caretColor: cssVar(tokens.accent),
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: cssVar(tokens.accent),
    borderLeftWidth: '2px',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: cssVar(tokens.textColor.disabled),
    borderRight: `1px solid ${cssVar(tokens.border.subtle)}`,
  },
  '.cm-activeLineGutter': {
    backgroundColor: cssVar(tokens.surface.hover),
    color: cssVar(tokens.textColor.secondary),
  },
  '.cm-activeLine': {
    backgroundColor: cssVar(tokens.surface.hover),
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: `0 ${cssVar(tokens.space[2])}`,
    fontVariantNumeric: 'tabular-nums',
  },
  '.cm-foldGutter .cm-gutterElement': {
    padding: '0 2px',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  // Selection has to win over the active-line fill, or a selection inside the
  // active line becomes invisible.
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    {
      backgroundColor: cssVar(tokens.surface.selected),
    },
  '.cm-matchingBracket, .cm-nonmatchingBracket': {
    backgroundColor: cssVar(tokens.surface.active),
    outline: `1px solid ${cssVar(tokens.border.default)}`,
  },
  '.cm-panels': {
    backgroundColor: cssVar(tokens.surface.raised),
    color: cssVar(tokens.textColor.primary),
    borderTop: `1px solid ${cssVar(tokens.border.subtle)}`,
  },
  '.cm-searchMatch': {
    backgroundColor: cssVar(tokens.accentMuted),
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: cssVar(tokens.accent),
    color: cssVar(tokens.accentContrast),
  },
  '.cm-tooltip': {
    backgroundColor: cssVar(tokens.surface.overlay),
    border: `1px solid ${cssVar(tokens.border.default)}`,
    borderRadius: cssVar(tokens.radius.content),
    color: cssVar(tokens.textColor.primary),
  },
})
