import { markdown } from '@codemirror/lang-markdown'
import {
  defaultHighlightStyle,
  highlightingFor,
  syntaxHighlighting,
} from '@codemirror/language'
import { EditorState, type Extension } from '@codemirror/state'
import { type Tag, tags } from '@lezer/highlight'
import {
  editorMarkdownHighlight,
  editorTheme,
  editorVisualTheme,
} from '@src/editor/plugins/theme'
import { describe, expect, it } from 'vitest'

// The plain-text/Markdown pane (TextFileEditor) layers a Markdown highlight
// style on top of the shared editor theme. CodeMirror resolves highlighters
// all-or-nothing: if any "main" highlighter is registered, every "fallback"
// highlighter is ignored (see getHighlighters in @codemirror/language). These
// tests pin down that the theme we hand the text editor styles Markdown, and
// that dark mode gets its own (readable) palette rather than reusing light
// colors.
function classFor(extensions: Extension[], tag: Tag) {
  const state = EditorState.create({ doc: '# heading', extensions })
  return highlightingFor(state, [tag])
}

// `heading` covers heading1–heading6; the rest are the Markdown content tags
// emitted by @lezer/markdown.
const MARKDOWN_TAGS: Tag[] = [
  tags.heading,
  tags.heading1,
  tags.emphasis,
  tags.strong,
  tags.link,
  tags.url,
  tags.monospace,
  tags.list,
]

describe('Markdown highlighting in the text file editor', () => {
  it('regression: the KCL editor theme suppresses Markdown highlighting', () => {
    // The original bug: editorTheme registers the KCL HighlightStyle as a
    // "main" highlighter, so a Markdown style added with { fallback: true } is
    // discarded and Markdown tags render unstyled.
    const cls = classFor(
      [
        editorTheme.light,
        markdown(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      ],
      tags.heading
    )
    expect(cls).toBeNull()
  })

  it('styles Markdown in light mode', () => {
    for (const tag of MARKDOWN_TAGS) {
      const cls = classFor(
        [editorVisualTheme.light, markdown(), editorMarkdownHighlight.light],
        tag
      )
      expect(
        cls,
        `light: expected a highlight class for ${String(tag)}`
      ).toBeTruthy()
    }
  })

  it('styles Markdown in dark mode with its own dark-tuned style', () => {
    for (const tag of MARKDOWN_TAGS) {
      const cls = classFor(
        [editorVisualTheme.dark, markdown(), editorMarkdownHighlight.dark],
        tag
      )
      expect(
        cls,
        `dark: expected a highlight class for ${String(tag)}`
      ).toBeTruthy()
    }
  })

  it('the dark Markdown style only activates under the dark theme', () => {
    // darkMarkdownHighlights has themeType 'dark', so it is gated on
    // EditorView.darkTheme. Pairing it with the light visual theme yields no
    // styling — proving dark mode uses a dedicated palette instead of the
    // light one, which is what made dark mode unreadable before.
    const cls = classFor(
      [editorVisualTheme.light, markdown(), editorMarkdownHighlight.dark],
      tags.heading
    )
    expect(cls).toBeNull()
  })

  it('editorVisualTheme carries no syntax highlighter of its own', () => {
    // Without a language + highlight style there is nothing to highlight; the
    // visual theme must not sneak the KCL highlighter back in.
    expect(classFor([editorVisualTheme.dark], tags.heading)).toBeNull()
    expect(classFor([editorVisualTheme.light], tags.heading)).toBeNull()
  })
})
