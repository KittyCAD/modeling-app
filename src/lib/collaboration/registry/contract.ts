import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { DocHandle } from '@automerge/automerge-repo'
import type { Editor } from '@src/lib/editors/registry/contract'

export interface CollaborativeText {
  text: string
}
/** Connection status is separate from the synchronous, always usable editor handle. */
export type CollaborationState =
  | { status: 'loading' }
  | { status: 'ready'; documentId: string; durable: boolean; error?: Error }
  | { status: 'error'; error: Error }

/** Own CRDT identity and persistence independently of file paths and CodeMirror mounts. */
export interface CollaborationService {
  state: (editor: Editor) => ReadonlySignal<CollaborationState>
  ready: (editor: Editor) => Promise<DocHandle<CollaborativeText>>
  flush: () => Promise<void>
}
export const { collaborationService } = defineContract({
  collaborationService: defineService<CollaborationService>(
    'editors.collaboration'
  ),
})
