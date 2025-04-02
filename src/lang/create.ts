import type { Name } from '@rust/kcl-lib/bindings/Name'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { TagDeclarator } from '@rust/kcl-lib/bindings/TagDeclarator'

import { getNodeFromPath } from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { ARG_TAG } from '@src/lang/std/sketch'
import { findKwArg } from '@src/lang/util'
import type {
  ArrayExpression,
  BinaryExpression,
  CallExpression,
  CallExpressionKw,
  Expr,
  Identifier,
  LabeledArg,
  Literal,
  LiteralValue,
  ObjectExpression,
  PathToNode,
  PipeExpression,
  PipeSubstitution,
  Program,
  SourceRange,
  UnaryExpression,
  VariableDeclaration,
  VariableDeclarator,
} from '@src/lang/wasm'
import { formatNumber } from '@src/lang/wasm'
import { err } from '@src/lib/trap'

/**
 * Note: This depends on WASM, but it's not async.  Callers are responsible for
 * awaiting init of the WASM module.
 */
export function createLiteral(value: LiteralValue | number): Node<Literal> {
  if (typeof value === 'number') {
    value = { value, suffix: 'None' }
  }
  let raw: string
  if (typeof value === 'string') {
    // TODO: Should we handle escape sequences?
    raw = `${value}`
  } else if (typeof value === 'boolean') {
    raw = `${value}`
  } else if (typeof value.value === 'number' && value.suffix === 'None') {
    // Fast path for numbers when there are no units.
    raw = `${value.value}`
  } else {
    raw = formatNumber(value.value, value.suffix)
  }
  return {
    type: 'Literal',
    start: 0,
    end: 0,
    moduleId: 0,
    value,
    raw,
    outerAttrs: [],
    preComments: [],
    commentStart: 0,
  }
}

export function createTagDeclarator(value: string): Node<TagDeclarator> {
  return {
    type: 'TagDeclarator',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
    preComments: [],
    commentStart: 0,

    value,
  }
}

export function createIdentifier(name: string): Node<Identifier> {
  return {
    type: 'Identifier',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
    preComments: [],
    commentStart: 0,

    name,
  }
}

export function createLocalName(name: string): Node<Name> {
  return {
    type: 'Name',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
    preComments: [],
    commentStart: 0,

    abs_path: false,
    path: [],
    name: createIdentifier(name),
  }
}

export function createName(path: [string], name: string): Node<Name> {
  return {
    type: 'Name',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
    preComments: [],
    commentStart: 0,

    abs_path: false,
    path: path.map(createIdentifier),
    name: createIdentifier(name),
  }
}

export function createPipeSubstitution(): Node<PipeSubstitution> {
  return {
    type: 'PipeSubstitution',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
    preComments: [],
    commentStart: 0,
  }
}

export function createCallExpressionStdLib(
  name: string,
  args: CallExpression['arguments']
): Node<CallExpression> {
  return {
    type: 'CallExpression',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
    preComments: [],
    commentStart: 0,
    callee: createLocalName(name),
    arguments: args,
  }
}

export const nonCodeMetaEmpty = () => {
  return { nonCodeNodes: {}, startNodes: [], start: 0, end: 0 }
}

export function createCallExpressionStdLibKw(
  name: string,
  unlabeled: CallExpressionKw['unlabeled'],
  args: CallExpressionKw['arguments']
): Node<CallExpressionKw> {
  return {
    type: 'CallExpressionKw',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
    preComments: [],
    commentStart: 0,
    nonCodeMeta: nonCodeMetaEmpty(),
    callee: createLocalName(name),
    unlabeled,
    arguments: args,
  }
}

export function createCallExpression(
  name: string,
  args: CallExpression['arguments']
): Node<CallExpression> {
  return {
    type: 'CallExpression',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
    preComments: [],
    commentStart: 0,
    callee: createLocalName(name),
    arguments: args,
  }
}

export function createArrayExpression(
  elements: ArrayExpression['elements']
): Node<ArrayExpression> {
  return {
    type: 'ArrayExpression',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
    preComments: [],
    commentStart: 0,

    nonCodeMeta: nonCodeMetaEmpty(),
    elements,
  }
}

export function createPipeExpression(
  body: PipeExpression['body']
): Node<PipeExpression> {
  return {
    type: 'PipeExpression',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
    preComments: [],
    commentStart: 0,

    body,
    nonCodeMeta: nonCodeMetaEmpty(),
  }
}

export function createVariableDeclaration(
  varName: string,
  init: VariableDeclarator['init'],
  visibility: VariableDeclaration['visibility'] = 'default',
  kind: VariableDeclaration['kind'] = 'const'
): Node<VariableDeclaration> {
  return {
    type: 'VariableDeclaration',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
    preComments: [],
    commentStart: 0,

    declaration: {
      type: 'VariableDeclarator',
      start: 0,
      end: 0,
      moduleId: 0,
      outerAttrs: [],
      preComments: [],
      commentStart: 0,

      id: createIdentifier(varName),
      init,
    },
    visibility,
    kind,
  }
}

export function createObjectExpression(properties: {
  [key: string]: Expr
}): Node<ObjectExpression> {
  return {
    type: 'ObjectExpression',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
    preComments: [],
    commentStart: 0,

    nonCodeMeta: nonCodeMetaEmpty(),
    properties: Object.entries(properties).map(([key, value]) => ({
      type: 'ObjectProperty',
      start: 0,
      end: 0,
      moduleId: 0,
      outerAttrs: [],
      preComments: [],
      commentStart: 0,
      key: createIdentifier(key),

      value,
    })),
  }
}

export function createUnaryExpression(
  argument: UnaryExpression['argument'],
  operator: UnaryExpression['operator'] = '-'
): Node<UnaryExpression> {
  return {
    type: 'UnaryExpression',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
    preComments: [],
    commentStart: 0,

    operator,
    argument,
  }
}

export function createBinaryExpression([left, operator, right]: [
  BinaryExpression['left'],
  BinaryExpression['operator'],
  BinaryExpression['right'],
]): Node<BinaryExpression> {
  return {
    type: 'BinaryExpression',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
    preComments: [],
    commentStart: 0,

    operator,
    left,
    right,
  }
}

export function createBinaryExpressionWithUnary([left, right]: [
  BinaryExpression['left'],
  BinaryExpression['right'],
]): Node<BinaryExpression> {
  if (right.type === 'UnaryExpression' && right.operator === '-')
    return createBinaryExpression([left, '-', right.argument])
  return createBinaryExpression([left, '+', right])
}

export function findUniqueName(
  ast: Program | string,
  name: string,
  pad = 3,
  index = 1
): string {
  let searchStr: string = typeof ast === 'string' ? ast : JSON.stringify(ast)
  const indexStr = String(index).padStart(pad, '0')

  const endingDigitsMatcher = /\d+$/
  const nameEndsInDigits = name.match(endingDigitsMatcher)
  let nameIsInString = searchStr.includes(`:"${name}"`)

  if (nameEndsInDigits !== null) {
    // base case: name is unique and ends in digits
    if (!nameIsInString) return name

    // recursive case: name is not unique and ends in digits
    const newPad = nameEndsInDigits[0].length
    const newIndex = parseInt(nameEndsInDigits[0]) + 1
    const nameWithoutDigits = name.replace(endingDigitsMatcher, '')

    return findUniqueName(searchStr, nameWithoutDigits, newPad, newIndex)
  }

  const newName = `${name}${indexStr}`
  nameIsInString = searchStr.includes(`:"${newName}"`)

  // base case: name is unique and does not end in digits
  if (!nameIsInString) return newName

  // recursive case: name is not unique and does not end in digits
  return findUniqueName(searchStr, name, pad, index + 1)
}

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
    const callNode = getNodeFromPath<CallExpression | CallExpressionKw>(
      ast,
      path,
      ['CallExpression', 'CallExpressionKw']
    )
    if (!err(callNode) && callNode.node.type === 'CallExpressionKw') {
      const { node: primaryCallExp } = callNode
      const existingTag = findKwArg(ARG_TAG, primaryCallExp)
      const tagDeclarator =
        existingTag || createTagDeclarator(tag || findUniqueName(ast, 'seg', 2))
      const isTagExisting = !!existingTag
      if (!isTagExisting) {
        callNode.node.arguments.push(createLabeledArg(ARG_TAG, tagDeclarator))
      }
      return { tagDeclarator, isTagExisting }
    }

    // We've handled CallExpressionKw above, so this has to be positional.
    const _node1 = getNodeFromPath<CallExpression>(ast, path, 'CallExpression')
    if (err(_node1)) return _node1
    const { node: primaryCallExp } = _node1

    // Tag is always 3rd expression now, using arg index feels brittle
    // but we can come up with a better way to identify tag later.
    const thirdArg = primaryCallExp.arguments?.[2]
    const tagDeclarator =
      thirdArg ||
      (createTagDeclarator(
        tag || findUniqueName(ast, 'seg', 2)
      ) as TagDeclarator)
    const isTagExisting = !!thirdArg
    if (!isTagExisting) {
      primaryCallExp.arguments[2] = tagDeclarator
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

export const createLabeledArg = (label: string, arg: Expr): LabeledArg => {
  return { label: createIdentifier(label), arg, type: 'LabeledArg' }
}
