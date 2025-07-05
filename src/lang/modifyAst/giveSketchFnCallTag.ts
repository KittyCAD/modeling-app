import type { Program } from '@rust/kcl-lib/bindings/Program'
import type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { CallExpressionKw, PathToNode } from '@src/lang/wasm'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { getNodeFromPath } from '@src/lang/queryAst'
import { err } from '@src/lib/trap'
import { ARG_TAG } from '@src/lang/constants'
import {
  createTagDeclarator,
  findUniqueName,
  createLabeledArg,
} from '@src/lang/create'
import { findKwArg } from '@src/lang/util'

export function giveSketchFnCallTag(
  ast: Node<Program>,
  range: SourceRange,
  tag?: string
):
  | {
      modifiedAst: Node<Program>
      tag: string
      isTagExisting: boolean
      pathToNode: PathToNode
    }
  | Error {
  const path = getNodePathFromSourceRange(ast, range)
  const maybeTag = (() => {
    const callNode = getNodeFromPath<CallExpressionKw>(ast, path, [
      'CallExpressionKw',
    ])
    if (err(callNode)) {
      return callNode
    }
    const { node: primaryCallExp } = callNode
    const existingTag = findKwArg(ARG_TAG, primaryCallExp)
    const tagDeclarator =
      existingTag || createTagDeclarator(tag || findUniqueName(ast, 'seg', 2))
    const isTagExisting = !!existingTag
    if (!isTagExisting) {
      callNode.node.arguments.push(createLabeledArg(ARG_TAG, tagDeclarator))
    }
    return { tagDeclarator, isTagExisting }
  })()

  if (err(maybeTag)) return maybeTag
  const { tagDeclarator, isTagExisting } = maybeTag
  if ('value' in tagDeclarator) {
    // Now TypeScript knows tagDeclarator has a value property
    return {
      modifiedAst: ast,
      tag: String(tagDeclarator.value),
      isTagExisting,
      pathToNode: path,
    }
  } else {
    return new Error('Unable to assign tag without value')
  }
}
