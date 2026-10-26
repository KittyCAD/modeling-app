import { signal } from '@preact/signals-core'

// Keep edit requests attached to their editor across file and project changes.
export const sketch3dEditRequest = signal<{
  editor: object
  label: string
} | null>(null)
