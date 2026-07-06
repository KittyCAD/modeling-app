import {
  MarkdownEditor,
  type MarkdownEditorNormalizeLinkHref,
  defaultNormalizeMarkdownLinkHref,
} from '@kittycad/ui-components'

type PublishMarkdownEditorProps = {
  id: string
  value: string
  onChange: (value: string) => void
  hasError?: boolean
  labelledBy?: string
  placeholder?: string
}

export function PublishMarkdownEditor({
  id,
  value,
  onChange,
  hasError = false,
  labelledBy,
  placeholder = '',
}: PublishMarkdownEditorProps) {
  return (
    <MarkdownEditor
      id={id}
      value={value}
      onChange={onChange}
      ariaLabel="Project description"
      className="mt-2"
      invalid={hasError}
      labelledBy={labelledBy}
      normalizeLinkHref={normalizePublishMarkdownLinkHref}
      placeholder={placeholder}
      testId="publish-project-description-editor"
    />
  )
}

export const normalizePublishMarkdownLinkHref: MarkdownEditorNormalizeLinkHref =
  defaultNormalizeMarkdownLinkHref
