import { defineEditorView } from '@src/lib/editors/views'
import { defineRegistryItemFactory, provide } from '@kittycad/registry'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createElement } from 'react'
import {
  editorViewValueSpec,
  codeEditorExtensionValueSpec,
} from '@src/lib/editors/registry/contract'
import { editorOnSaveValueSpec } from '@src/lib/save/registry/contract'
import { PngView } from '@src/lib/png/PngView'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'

/** PNG is a binary, read-only editor surface and has no executor dependency. */
const extension = defineRegistryItemFactory(({ services }) => {
  const readFile = (src: string) =>
    services.get(fileOperationsService).readFile(src)
  return {
    provides: [
      provide(
        editorViewValueSpec,
        defineEditorView({
          id: 'png.image',
          label: 'Image',
          matches: '.png',
          Component: ({ editor }) =>
            createElement(PngView, { editor, readFile }),
        })
      ),
      provide(codeEditorExtensionValueSpec, {
        id: 'png.readOnly',
        matches: '.png',
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
        ],
      }),
      // The text buffer is only a backing editor handle; writing it would corrupt the binary file.
      provide(editorOnSaveValueSpec, {
        id: 'png.preventTextSave',
        matches: '.png',
        order: -200,
        onSave: () => new Error('PNG images are read-only.'),
      }),
    ],
  }
}, 'png')
export default withProjectShellFeature(extension, 'png')
