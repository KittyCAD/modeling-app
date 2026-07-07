import {
  defaultNormalizeMarkdownLinkHref,
  MarkdownEditor,
  type MarkdownEditorNormalizeLinkHref,
  normalizeMarkdownEditorValue,
} from '@kittycad/ui-components'

type PublishMarkdownEditorProps = {
  id: string
  value: string
  onChange: (value: string) => void
  hasError?: boolean
  labelledBy?: string
  placeholder?: string
  required?: boolean
  describedBy?: string
}

export function PublishMarkdownEditor({
  id,
  value,
  onChange,
  hasError = false,
  labelledBy,
  placeholder = '',
  required = false,
  describedBy,
}: PublishMarkdownEditorProps) {
  return (
    <MarkdownEditor
      id={id}
      value={value}
      onChange={onChange}
      ariaLabel="Project description"
      className="mt-2"
      describedBy={describedBy}
      invalid={hasError}
      labelledBy={labelledBy}
      normalizeLinkHref={normalizePublishMarkdownLinkHref}
      placeholder={placeholder}
      required={required}
      testId="publish-project-description-editor"
    />
  )
}

export const normalizePublishMarkdownLinkHref: MarkdownEditorNormalizeLinkHref =
  defaultNormalizeMarkdownLinkHref

export function normalizePublishMarkdownValue(value: string) {
  return normalizeMarkdownEditorValue(value, {
    normalizeLinkHref: normalizePublishMarkdownLinkHref,
  })
}
