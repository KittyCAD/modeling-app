import { CodeDiffView } from '@src/components/CodeDiffView'
import { useResolvedTheme } from '@src/hooks/useResolvedTheme'
import type { CodeChangesPreview as Preview } from '@src/lib/codeChangesPreview'

/** Read-only code proposed by the active modeling dialog. */
export function CodeChangesPreview({
  preview,
  onClose,
}: {
  preview: Preview
  onClose: () => void
}) {
  const theme = useResolvedTheme()
  return (
    <div
      className="flex h-full min-h-0 flex-col p-2 text-xs"
      role="region"
      aria-label="Code changes"
    >
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <span className="truncate font-medium">{preview.title}</span>
        <button
          type="button"
          aria-label="Close code changes"
          className="m-0 shrink-0 rounded-sm border border-chalkboard-30 px-2 py-1 dark:border-chalkboard-70"
          onClick={onClose}
        >
          Back to code
        </button>
      </div>
      {preview.status === 'loading' && (
        <p role="status">Preparing preview...</p>
      )}
      {preview.status === 'error' && <p role="alert">{preview.error}</p>}
      {preview.status === 'ready' && (
        <CodeDiffView
          beforeText={preview.beforeText}
          afterText={preview.afterText}
          beforeLabel="Before"
          afterLabel="After (read-only)"
          language="kcl"
          resolvedTheme={theme}
          layout="unified"
          fullHeight
          testId="code-changes-diff"
        />
      )}
    </div>
  )
}
