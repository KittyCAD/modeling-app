import { useSignals } from '@preact/signals-react/runtime'
import type { Editor, EditorNaming } from '@src/lib/editors/registry/contract'
import { reportRejection } from '@src/lib/trap'
import { useEffect, useId, useRef, useState } from 'react'

/** A tab's temporary path control, separate from the tab button's keyboard handling. */
export function EditorPathInput({
  editor,
  naming,
  onFinish,
}: {
  editor: Editor
  naming: EditorNaming
  onFinish: () => void
}) {
  useSignals()
  const request = naming.state(editor).value
  const [path, setPath] = useState(request?.initialPath ?? '')
  const input = useRef<HTMLInputElement>(null)
  const errorId = useId()
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  if (!request) return null
  const finish = () => {
    naming.cancel(editor)
    onFinish()
  }
  return (
    <span className="relative inline-flex flex-col px-1">
      <input
        ref={input}
        aria-label="Project-relative file path"
        aria-invalid={!!request.error}
        aria-describedby={request.error ? errorId : undefined}
        className="h-6 w-48 rounded-sm border b-4 bg-default px-1 text-xs text-default outline-primary"
        value={path}
        readOnly={request.pending}
        aria-busy={request.pending}
        onChange={(event) => setPath(event.target.value)}
        onBlur={() => {
          if (!request.pending) naming.cancel(editor)
        }}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Escape') {
            event.preventDefault()
            if (!request.pending) finish()
          } else if (event.key === 'Enter') {
            event.preventDefault()
            if (!request.pending)
              void naming
                .submit(editor, path)
                .then(() => {
                  if (!naming.state(editor).peek()) onFinish()
                })
                .catch(reportRejection)
          }
        }}
      />
      {request.error && (
        <span id={errorId} role="alert" className="text-xs text-default">
          {request.error}
        </span>
      )}
    </span>
  )
}
