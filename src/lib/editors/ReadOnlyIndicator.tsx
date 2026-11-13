import { useSignals } from '@preact/signals-react/runtime'
import type { Editor } from '@src/lib/editors/registry/contract'

/** Document restrictions remain visible regardless of the tab's selected mode. */
export function ReadOnlyIndicator({ editor }: { editor: Editor }) {
  useSignals()
  if (!editor.readOnly.value) return null
  return (
    <span className="shrink-0 rounded border b-4 px-1 text-xs font-normal text-2">
      Read-only
    </span>
  )
}
