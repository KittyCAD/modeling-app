import { useState } from 'react'
import { CodeDiffView } from '@src/components/CodeDiffView'
import { useResolvedTheme } from '@src/hooks/useResolvedTheme'
import {
  clearCodeChangesPreview,
  type CodeChangesPreview as Preview,
} from '@src/lib/codeChangesPreview'
import fsZds from '@src/lib/fs-zds'

/** Shared editor-pane surface for proposed modeling code or applied AI edits. */
export function CodeChangesPreview({ preview }: { preview: Preview }) {
  const theme = useResolvedTheme()
  const [selectedPath, setSelectedPath] = useState<string>()
  const file =
    preview.files.find(({ path }) => path === selectedPath) ?? preview.files[0]
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
          onClick={() => clearCodeChangesPreview(preview.owner)}
        >
          Back to code
        </button>
      </div>
      {file && (
        <div className="mb-2 shrink-0">
          {preview.files.length > 1 ? (
            <select
              aria-label="Changed file"
              value={file.path}
              onChange={(event) => setSelectedPath(event.target.value)}
              className="w-full rounded-sm border border-chalkboard-30 bg-transparent px-2 py-1 dark:border-chalkboard-70"
            >
              {preview.files.map(({ path }) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-chalkboard-70 dark:text-chalkboard-40">
              {fsZds.basename(file.path)}
            </span>
          )}
        </div>
      )}
      {preview.status === 'loading' && (
        <p role="status">Preparing preview...</p>
      )}
      {preview.status === 'error' && <p role="alert">{preview.error}</p>}
      {preview.status === 'ready' && file && (
        <CodeDiffView
          beforeText={file.beforeText}
          afterText={file.afterText}
          beforeLabel="Before"
          afterLabel="After (read-only)"
          language={file.language}
          resolvedTheme={theme}
          layout="unified"
          fullHeight
          testId="code-changes-diff"
        />
      )}
    </div>
  )
}
