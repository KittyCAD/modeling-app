import { signal } from '@preact/signals-core'
import type { CodeDiffLanguage } from '@src/components/CodeDiffView'

export type CodeChangeFile = {
  path: string
  beforeText: string
  afterText: string
  language: CodeDiffLanguage
}

/** Display-only snapshots. Applying changes and undo remain with the caller. */
export type CodeChangesPreview = {
  owner: object
  title: string
  files: readonly CodeChangeFile[]
  status: 'loading' | 'ready' | 'error'
  error?: string
}

export const codeChangesPreviewSignal = signal<CodeChangesPreview | null>(null)

export function clearCodeChangesPreview(owner: object) {
  if (codeChangesPreviewSignal.peek()?.owner === owner) {
    codeChangesPreviewSignal.value = null
  }
}
