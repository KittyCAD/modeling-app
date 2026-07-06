import { Link } from '@tiptap/extension-link'
import { Markdown } from '@tiptap/markdown'
import { EditorContent, useEditor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { type ReactNode, useEffect, useMemo } from 'react'

export type MarkdownEditorFeature =
  | 'bold'
  | 'italic'
  | 'link'
  | 'bulletList'
  | 'orderedList'
  | 'undoRedo'

export type MarkdownEditorNormalizeLinkHref = (
  value: string | undefined
) => string | null

export interface MarkdownEditorProps {
  id: string
  value: string
  onChange: (value: string) => void
  ariaLabel?: string
  className?: string
  editorClassName?: string
  features?: readonly MarkdownEditorFeature[]
  invalid?: boolean
  labelledBy?: string
  normalizeLinkHref?: MarkdownEditorNormalizeLinkHref
  placeholder?: string
  promptForLink?: (currentHref: string) => string | null
  testId?: string
}

export const defaultMarkdownEditorFeatures = [
  'bold',
  'italic',
  'link',
  'bulletList',
  'orderedList',
  'undoRedo',
] as const satisfies readonly MarkdownEditorFeature[]

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

export function MarkdownEditor({
  id,
  value,
  onChange,
  ariaLabel = 'Markdown editor',
  className = '',
  editorClassName = '',
  features = defaultMarkdownEditorFeatures,
  invalid = false,
  labelledBy,
  normalizeLinkHref = defaultNormalizeMarkdownLinkHref,
  placeholder = '',
  promptForLink,
  testId = 'markdown-editor',
}: MarkdownEditorProps) {
  const enabledFeatures = useMemo(() => new Set(features), [features])
  const hasLists =
    enabledFeatures.has('bulletList') || enabledFeatures.has('orderedList')
  const hasLink = enabledFeatures.has('link')
  const hasUndoRedo = enabledFeatures.has('undoRedo')

  const editorAttributes = useMemo(
    () => ({
      ...(labelledBy
        ? { 'aria-labelledby': labelledBy }
        : { 'aria-label': ariaLabel }),
      'aria-invalid': invalid ? 'true' : 'false',
      'aria-multiline': 'true',
      'data-testid': testId,
      id,
      role: 'textbox',
    }),
    [ariaLabel, id, invalid, labelledBy, testId]
  )

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        blockquote: false,
        bold: enabledFeatures.has('bold') ? undefined : false,
        bulletList: enabledFeatures.has('bulletList') ? undefined : false,
        code: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        italic: enabledFeatures.has('italic') ? undefined : false,
        link: false,
        listItem: hasLists ? undefined : false,
        listKeymap: hasLists ? undefined : false,
        orderedList: enabledFeatures.has('orderedList') ? undefined : false,
        strike: false,
        underline: false,
        undoRedo: hasUndoRedo ? undefined : false,
      }),
      ...(hasLink
        ? [
            createSafeLinkExtension(normalizeLinkHref).configure({
              autolink: true,
              defaultProtocol: 'https',
              HTMLAttributes: {
                target: '_blank',
                rel: 'noopener noreferrer nofollow',
                class: null,
              },
              isAllowedUri: (url) => normalizeLinkHref(url) !== null,
              linkOnPaste: true,
              openOnClick: false,
            }),
          ]
        : []),
      Markdown.configure({
        markedOptions: {
          breaks: true,
          gfm: true,
        },
      }),
    ],
    [enabledFeatures, hasLink, hasLists, hasUndoRedo, normalizeLinkHref]
  )

  const editor = useEditor({
    content: value,
    contentType: 'markdown',
    editorProps: {
      attributes: editorAttributes,
    },
    extensions,
    immediatelyRender: true,
    onUpdate: ({ editor }) => {
      onChange(editor.getMarkdown())
    },
    shouldRerenderOnTransaction: true,
  })

  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      return
    }

    const currentMarkdown = editor.getMarkdown()
    if (currentMarkdown === value) {
      return
    }

    editor.commands.setContent(value, {
      contentType: 'markdown',
      emitUpdate: false,
    })
  }, [editor, value])

  function setLink() {
    if (!editor) {
      return
    }

    const currentHref = editor.getAttributes('link').href
    const rawHref = promptForLink
      ? promptForLink(typeof currentHref === 'string' ? currentHref : '')
      : window.prompt(
          'Link URL',
          typeof currentHref === 'string' ? currentHref : ''
        )

    if (rawHref === null) {
      return
    }

    if (!rawHref.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }

    const safeHref = normalizeLinkHref(rawHref)
    if (!safeHref) {
      return
    }

    if (editor.state.selection.empty && !editor.isActive('link')) {
      editor
        .chain()
        .focus()
        .insertContent(`[${safeHref}](${safeHref})`, {
          contentType: 'markdown',
        })
        .run()
      return
    }

    editor
      .chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: safeHref })
      .run()
  }

  return (
    <div
      className={`overflow-hidden rounded border bg-chalkboard-10/90 text-sm text-chalkboard-100 focus-within:outline focus-within:outline-2 focus-within:outline-appForeground dark:bg-chalkboard-90/80 dark:text-chalkboard-10 ${
        invalid
          ? 'border-destroy-60'
          : 'border-chalkboard-20/80 dark:border-chalkboard-80/70'
      } ${className}`}
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-chalkboard-20/80 bg-chalkboard-10/70 p-1 dark:border-chalkboard-80/70 dark:bg-chalkboard-100/30">
        {enabledFeatures.has('bold') && (
          <EditorToolbarButton
            label="Bold"
            pressed={editor?.isActive('bold') ?? false}
            disabled={!editor}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <span className="font-semibold">B</span>
          </EditorToolbarButton>
        )}
        {enabledFeatures.has('italic') && (
          <EditorToolbarButton
            label="Italic"
            pressed={editor?.isActive('italic') ?? false}
            disabled={!editor}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <span className="italic">I</span>
          </EditorToolbarButton>
        )}
        {hasLink && (
          <EditorToolbarButton
            label="Link"
            pressed={editor?.isActive('link') ?? false}
            disabled={!editor}
            onClick={setLink}
          >
            <LinkIcon />
          </EditorToolbarButton>
        )}
        {hasLists && (
          <div className="mx-1 h-5 w-px bg-chalkboard-20 dark:bg-chalkboard-80" />
        )}
        {enabledFeatures.has('bulletList') && (
          <EditorToolbarButton
            label="Bulleted list"
            pressed={editor?.isActive('bulletList') ?? false}
            disabled={!editor}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <ListIcon ordered={false} />
          </EditorToolbarButton>
        )}
        {enabledFeatures.has('orderedList') && (
          <EditorToolbarButton
            label="Numbered list"
            pressed={editor?.isActive('orderedList') ?? false}
            disabled={!editor}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <ListIcon ordered={true} />
          </EditorToolbarButton>
        )}
        {hasUndoRedo && (
          <div className="mx-1 h-5 w-px bg-chalkboard-20 dark:bg-chalkboard-80" />
        )}
        {hasUndoRedo && (
          <EditorToolbarButton
            label="Undo"
            disabled={!editor?.can().undo()}
            onClick={() => editor?.chain().focus().undo().run()}
          >
            <UndoIcon />
          </EditorToolbarButton>
        )}
        {hasUndoRedo && (
          <EditorToolbarButton
            label="Redo"
            disabled={!editor?.can().redo()}
            onClick={() => editor?.chain().focus().redo().run()}
          >
            <RedoIcon />
          </EditorToolbarButton>
        )}
      </div>
      <div className="relative">
        {editor?.isEmpty && placeholder && (
          <div className="pointer-events-none absolute left-2.5 top-2 text-sm text-chalkboard-60 dark:text-chalkboard-40">
            {placeholder}
          </div>
        )}
        <EditorContent
          editor={editor}
          className={`markdown-editor ${editorClassName}`}
        />
      </div>
    </div>
  )
}

function createSafeLinkExtension(
  normalizeLinkHref: MarkdownEditorNormalizeLinkHref
) {
  return Link.extend({
    parseMarkdown: (token, helpers) => {
      const href = getMarkdownTokenString(token, 'href')
      const safeHref = normalizeLinkHref(href)
      const content = helpers.parseInline(token.tokens || [])

      if (!safeHref) {
        return content
      }

      return helpers.applyMark('link', content, {
        href: safeHref,
        title: getMarkdownTokenString(token, 'title') || null,
      })
    },
  })
}

function EditorToolbarButton({
  label,
  pressed,
  disabled = false,
  onClick,
  children,
}: {
  label: string
  pressed?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`m-0 flex h-7 w-7 items-center justify-center rounded border px-0 text-xs leading-none transition-colors focus-visible:outline-appForeground disabled:opacity-50 ${
        pressed
          ? 'border-chalkboard-50 bg-chalkboard-20 text-chalkboard-100 dark:border-chalkboard-50 dark:bg-chalkboard-70 dark:text-chalkboard-10'
          : 'border-transparent bg-transparent text-chalkboard-70 hover:border-chalkboard-20 hover:bg-chalkboard-20/60 hover:text-chalkboard-100 dark:text-chalkboard-30 dark:hover:border-chalkboard-70 dark:hover:bg-chalkboard-80/70 dark:hover:text-chalkboard-10'
      }`}
    >
      {children}
    </button>
  )
}

function LinkIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path
        d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L11 4.93"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 0 0 7.07 7.07L13 19.07"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  )
}

function UndoIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path
        d="M9 14 4 9l5-5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M4 9h10a6 6 0 0 1 0 12h-1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  )
}

function RedoIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path
        d="m15 14 5-5-5-5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M20 9H10a6 6 0 0 0 0 12h1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  )
}

function ListIcon({ ordered }: { ordered: boolean }) {
  return (
    <span className="grid h-4 w-4 grid-cols-[0.35rem_1fr] items-center gap-x-1 text-[0.55rem] leading-none">
      <span className="text-center">{ordered ? '1' : '-'}</span>
      <span className="h-px bg-current" />
      <span className="text-center">{ordered ? '2' : '-'}</span>
      <span className="h-px bg-current" />
      <span className="text-center">{ordered ? '3' : '-'}</span>
      <span className="h-px bg-current" />
    </span>
  )
}

export function defaultNormalizeMarkdownLinkHref(value: string | undefined) {
  const trimmedValue = value?.trim()
  if (!trimmedValue) {
    return null
  }

  const href = hasUrlScheme(trimmedValue)
    ? trimmedValue
    : `https://${trimmedValue}`

  try {
    const url = new URL(href)
    if (!SAFE_LINK_PROTOCOLS.has(url.protocol)) {
      return null
    }

    return url.href
  } catch {
    return null
  }
}

function hasUrlScheme(value: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(value)
}

function getMarkdownTokenString(
  token: { [key: string]: unknown },
  key: string
) {
  const value = token[key]
  return typeof value === 'string' ? value : undefined
}
