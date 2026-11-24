import { computed, signal, type ReadonlySignal } from '@preact/signals-core'
import { matchesEditor } from '@src/lib/editors/matching'
import type {
  EditorClassification,
  EditorLanguage,
} from '@src/lib/editors/registry/contract'

/** An explicit language wins over source inference, without changing the buffer's path or text. */
export function createEditorClassification(
  src: ReadonlySignal<string | undefined>,
  contents: ReadonlySignal<string>,
  languages: ReadonlySignal<readonly EditorLanguage[]>
) {
  const choice = signal<string | undefined>(undefined)
  const classification = computed<EditorClassification | undefined>(() => {
    const source = { src: src.value ?? '', contents: contents.value }
    const descriptors = languages.value
    const selected =
      descriptors.find((language) => language.id === choice.value) ??
      descriptors
        .filter((language) => matchesEditor(language.matches, source))
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0]
    return selected
      ? { languageId: selected.id, mediaType: selected.mediaType }
      : undefined
  })
  return {
    classification,
    select: (languageId: string | undefined): Error | undefined => {
      if (
        languageId !== undefined &&
        !languages.peek().some((language) => language.id === languageId)
      )
        return new Error(`Unknown editor language: ${languageId}`)
      choice.value = languageId
    },
  }
}
