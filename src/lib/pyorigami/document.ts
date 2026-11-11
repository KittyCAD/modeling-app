import type { EditorMatchContext } from '@src/lib/editors/matching'

export const PYORIGAMI_DOCUMENT = 'pyorigami'

/** Python source with an explicit origami identity, independent of its filename. */
export function matchesPyorigami(context: EditorMatchContext): boolean {
  return (
    context.documentType === PYORIGAMI_DOCUMENT ||
    context.languageId === PYORIGAMI_DOCUMENT ||
    isPyorigamiSource(context)
  )
}

export function isPyorigamiSource({ src }: { src: string }): boolean {
  return src.toLowerCase().endsWith('.origami.py')
}
