import { useSignals } from '@preact/signals-react/runtime'
import type { Executor } from '@src/lib/executors/registry/contract'
import { attachSafeLinkHandler } from '@src/lib/markdown'
import { markdownExecutorCapability } from '@src/lib/markdown/executor'
import { useEffect, useRef } from 'react'
import styles from './MarkdownPreview.module.css'

/** Displays the executor's rendered output; parsing and editor ownership stay outside the view. */
export function MarkdownPreview({ executor }: { executor: Executor }) {
  useSignals()
  const root = useRef<HTMLElement>(null)
  const output = executor.output.value
  const error = output.errors[markdownExecutorCapability.id]
  const html = output.get(markdownExecutorCapability)?.html
  useEffect(() => {
    if (root.current) return attachSafeLinkHandler(root.current)
  }, [])

  return (
    <article
      ref={root}
      aria-label="Markdown preview"
      aria-busy={output.running}
      className="min-h-0 min-w-0 flex-1 overflow-auto p-6 max-w-5xl mx-auto"
    >
      {output.running ? (
        <p role="status">Rendering Markdown...</p>
      ) : error ? (
        <p role="alert">{error.message}</p>
      ) : (
        <div
          className={`parsed-markdown ${styles.document}`}
          dangerouslySetInnerHTML={{
            __html: html ?? '',
          }}
        />
      )}
    </article>
  )
}
