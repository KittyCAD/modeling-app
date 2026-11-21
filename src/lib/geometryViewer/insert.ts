import type { Editor } from '@src/lib/editors/registry/contract'
import { isErr } from '@src/lib/trap'
import fsZds from '@src/lib/fs-zds'
import { geometryImport } from '@src/lib/geometryViewer/formats'

/** One undoable import edit; a fresh alias avoids names already present in the target document. */
export function insertGeometryImport(
  target: Editor,
  modelPath: string
): Error | undefined {
  if (target.signal.aborted) return new Error('The KCL editor is closed')
  if (target.readOnly.peek()) return new Error('The KCL editor is read-only')
  const src = target.src.peek()
  if (!src || fsZds.extname(src).toLowerCase() !== '.kcl')
    return new Error('Choose a saved KCL file')
  const contents = target.contents.peek()
  let alias = 'importedModel'
  let suffix = 2
  while (new RegExp(`\\b${alias}\\b`).test(contents))
    alias = `importedModel${suffix++}`
  const statement = geometryImport(
    fsZds.relative(fsZds.dirname(src), modelPath),
    alias
  )
  if (isErr(statement)) return statement
  target.dispatch({
    changes: {
      from: target.state.doc.length,
      insert: `${contents && !contents.endsWith('\n') ? '\n' : ''}${statement}\n`,
    },
  })
}
