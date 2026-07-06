import { CustomIcon } from '@src/components/CustomIcon'
import { Link } from '@tiptap/extension-link'
import { Markdown } from '@tiptap/markdown'
import { EditorContent, useEditor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { type ReactNode, useEffect, useMemo } from 'react'

type PublishMarkdownEditorProps = {
  id: string
  value: string
  onChange: (value: string) => void
  hasError?: boolean
  labelledBy?: string
  placeholder?: string
}

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

const SafeLink = Link.extend({
  parseMarkdown: (token, helpers) => {
    const href = getMarkdownTokenString(token, 'href')
    const safeHref = normalizePublishMarkdownLinkHref(href)
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

export function PublishMarkdownEditor({
  id,
  value,
  onChange,
  hasError = false,
  labelledBy,
  placeholder = '',
}: PublishMarkdownEditorProps) {
  const editorAttributes = useMemo(
    () => ({
      ...(labelledBy
        ? { 'aria-labelledby': labelledBy }
        : { 'aria-label': 'Project description' }),
      'aria-invalid': hasError ? 'true' : 'false',
      'aria-multiline': 'true',
      'data-testid': 'publish-project-description-editor',
      id,
      role: 'textbox',
    }),
    [hasError, id, labelledBy]
  )
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        blockquote: false,
        code: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        link: false,
        strike: false,
        underline: false,
      }),
      SafeLink.configure({
        autolink: true,
        defaultProtocol: 'https',
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer nofollow',
          class: null,
        },
        isAllowedUri: (url) => isSafePublishMarkdownLinkHref(url),
        linkOnPaste: true,
        openOnClick: false,
      }),
      Markdown.configure({
        markedOptions: {
          breaks: true,
          gfm: true,
        },
      }),
    ],
    []
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
    const rawHref = window.prompt(
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

    const safeHref = normalizePublishMarkdownLinkHref(rawHref)
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
      className={`mt-2 overflow-hidden rounded border bg-chalkboard-10/90 text-sm text-chalkboard-100 focus-within:outline focus-within:outline-2 focus-within:outline-appForeground dark:bg-chalkboard-90/80 dark:text-chalkboard-10 ${
        hasError
          ? 'border-destroy-60'
          : 'border-chalkboard-20/80 dark:border-chalkboard-80/70'
      }`}
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-chalkboard-20/80 bg-chalkboard-10/70 p-1 dark:border-chalkboard-80/70 dark:bg-chalkboard-100/30">
        <EditorToolbarButton
          label="Bold"
          pressed={editor?.isActive('bold') ?? false}
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <span className="font-semibold">B</span>
        </EditorToolbarButton>
        <EditorToolbarButton
          label="Italic"
          pressed={editor?.isActive('italic') ?? false}
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <span className="italic">I</span>
        </EditorToolbarButton>
        <EditorToolbarButton
          label="Link"
          pressed={editor?.isActive('link') ?? false}
          disabled={!editor}
          onClick={setLink}
        >
          <CustomIcon name="link" className="h-4 w-4" />
        </EditorToolbarButton>
        <div className="mx-1 h-5 w-px bg-chalkboard-20 dark:bg-chalkboard-80" />
        <EditorToolbarButton
          label="Bulleted list"
          pressed={editor?.isActive('bulletList') ?? false}
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <ListIcon ordered={false} />
        </EditorToolbarButton>
        <EditorToolbarButton
          label="Numbered list"
          pressed={editor?.isActive('orderedList') ?? false}
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          <ListIcon ordered={true} />
        </EditorToolbarButton>
        <div className="mx-1 h-5 w-px bg-chalkboard-20 dark:bg-chalkboard-80" />
        <EditorToolbarButton
          label="Undo"
          disabled={!editor?.can().undo()}
          onClick={() => editor?.chain().focus().undo().run()}
        >
          <CustomIcon name="arrowTurnLeft" className="h-4 w-4" />
        </EditorToolbarButton>
        <EditorToolbarButton
          label="Redo"
          disabled={!editor?.can().redo()}
          onClick={() => editor?.chain().focus().redo().run()}
        >
          <CustomIcon name="arrowTurnRight" className="h-4 w-4" />
        </EditorToolbarButton>
      </div>
      <div className="relative">
        {editor?.isEmpty && placeholder && (
          <div className="pointer-events-none absolute left-2.5 top-2 text-sm text-chalkboard-60 dark:text-chalkboard-40">
            {placeholder}
          </div>
        )}
        <EditorContent editor={editor} className="publish-markdown-editor" />
      </div>
    </div>
  )
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

function ListIcon({ ordered }: { ordered: boolean }) {
  return (
    <span className="grid h-4 w-4 grid-cols-[0.35rem_1fr] items-center gap-x-1 text-[0.55rem] leading-none">
      <span className="text-center">{ordered ? '1' : '•'}</span>
      <span className="h-px bg-current" />
      <span className="text-center">{ordered ? '2' : '•'}</span>
      <span className="h-px bg-current" />
      <span className="text-center">{ordered ? '3' : '•'}</span>
      <span className="h-px bg-current" />
    </span>
  )
}

export function normalizePublishMarkdownLinkHref(value: string | undefined) {
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

function isSafePublishMarkdownLinkHref(value: string | undefined) {
  return normalizePublishMarkdownLinkHref(value) !== null
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
