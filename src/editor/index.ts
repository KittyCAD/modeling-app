import { Annotation } from '@codemirror/state'
import { EditorView } from 'codemirror'

export const wasUpdatedFromDisk = Annotation.define<boolean>()

/** Proof-of-concept editor extension to watch and act on updates from disk */
const updateFromDiskAlert = EditorView.updateListener.of((update) => {
  const weCare = update.transactions.some((tr) =>
    tr.annotation(wasUpdatedFromDisk)
  )

  if (weCare) {
    globalThis.alert('WOAH WE UPDATED FROM DISK')
  }
})

// Extensions are just arrays (or nested arrays) of Extensions
export const diskWatcher = () => [updateFromDiskAlert]
