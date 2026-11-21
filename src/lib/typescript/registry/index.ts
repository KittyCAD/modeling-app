import { javascript } from '@codemirror/lang-javascript'
import { editorTypeScriptHighlight } from '@src/editor/plugins/theme'
import {
  codeEditorsExtensionFacet,
  editorLanguagesFacet,
  type CodeEditorExtension,
  type EditorLanguage,
} from '@src/lib/editors/registry/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { contribute } from 'plankton'

/** Language classification is independent of plugin activation and applies to ordinary source files too. */
const definitions = [
  {
    id: 'typescript',
    suffix: /\.(?:ts|mts|cts)$/i,
    mediaType: 'text/typescript',
    typescript: true,
    jsx: false,
  },
  {
    id: 'typescriptreact',
    suffix: /\.tsx$/i,
    mediaType: 'text/tsx',
    typescript: true,
    jsx: true,
  },
  {
    id: 'javascript',
    suffix: /\.(?:js|mjs|cjs)$/i,
    mediaType: 'text/javascript',
    typescript: false,
    jsx: false,
  },
  {
    id: 'javascriptreact',
    suffix: /\.jsx$/i,
    mediaType: 'text/jsx',
    typescript: false,
    jsx: true,
  },
]

const extension = definitions.flatMap((definition) => {
  const language: EditorLanguage = {
    id: definition.id,
    mediaType: definition.mediaType,
    matches: ({ src }) => definition.suffix.test(src),
  }
  const code: CodeEditorExtension = {
    id: `editors.${definition.id}`,
    matches: ({ languageId }) => languageId === language.id,
    extensions: [
      javascript({ typescript: definition.typescript, jsx: definition.jsx }),
      editorTypeScriptHighlight,
    ],
  }
  return [
    contribute(editorLanguagesFacet, () => language),
    contribute(codeEditorsExtensionFacet, () => code),
  ]
})

export default withProjectShellFeature(extension, 'typescript')
