import type { ImportStatement } from '@rust/kcl-lib/bindings/ImportStatement'
import type { Name } from '@rust/kcl-lib/bindings/Name'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { type NonCodeMeta } from '@rust/kcl-lib/bindings/NonCodeMeta'
import type { TagDeclarator } from '@rust/kcl-lib/bindings/TagDeclarator'

import type { ImportPath } from '@rust/kcl-lib/bindings/ImportPath'
import type { ImportSelector } from '@rust/kcl-lib/bindings/ImportSelector'
import type { ItemVisibility } from '@rust/kcl-lib/bindings/ItemVisibility'
import { ARG_TAG } from '@src/lang/constants'
import { getNodeFromPath } from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { findKwArg } from '@src/lang/util'
import type {
  ArrayExpression,
  BinaryExpression,
  CallExpressionKw,
  Expr,
  ExpressionStatement,
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
import { formatNumberLiteral } from '@src/lang/wasm'
import { err } from '@src/lib/trap'

export function createLiteral(value: number | string | boolean): Node<Literal> {
  // TODO: Should we handle string escape sequences?
  return {
    type: 'Literal',
    start: 0,
    end: 0,
    moduleId: 0,
    value: typeof value === 'number' ? { value, suffix: 'None' } : value,
    raw: `${value}`,
    outerAttrs: [],
    preComments: [],
    commentStart: 0,
  }
}

/**
 * Note: This depends on WASM, but it's not async.  Callers are responsible for
 * awaiting init of the WASM module.
 */
export function createLiteralMaybeSuffix(
  value: LiteralValue
): Node<Literal> | Error {
  if (typeof value === 'string' || typeof value === 'boolean') {
    return createLiteral(value)
  }

  let raw: string
  if (typeof value.value === 'number' && value.suffix === 'None') {
    // Fast path for numbers when there are no units.
    raw = `${value.value}`
  } else {
    const formatted = formatNumberLiteral(value.value, value.suffix)
    if (err(formatted)) {
      return new Error(
        `Invalid number literal: value=${value.value}, suffix=${value.suffix}`,
        { cause: formatted }
      )
    }
    raw = formatted
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

export const nonCodeMetaEmpty = () => {
  return { nonCodeNodes: {}, startNodes: [], start: 0, end: 0 }
}

export function createCallExpressionStdLibKw(
  name: string,
  unlabeled: CallExpressionKw['unlabeled'],
  args: CallExpressionKw['arguments'],
  nonCodeMeta?: NonCodeMeta
): Node<CallExpressionKw> {
  return {
    type: 'CallExpressionKw',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
    preComments: [],
    commentStart: 0,
    nonCodeMeta: nonCodeMeta ?? nonCodeMetaEmpty(),
    callee: createLocalName(name),
    unlabeled,
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

export function createImportAsSelector(name: string): ImportSelector {
  return { type: 'None', alias: createIdentifier(name) }
}

export function createImportStatement(
  selector: ImportSelector,
  path: ImportPath,
  visibility: ItemVisibility = 'default'
): Node<ImportStatement> {
  return {
    type: 'ImportStatement',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
    preComments: [],
    commentStart: 0,
    selector,
    path,
    visibility,
  }
}

export function createExpressionStatement(
  expression: Expr
): Node<ExpressionStatement> {
  return {
    type: 'ExpressionStatement',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
    preComments: [],
    commentStart: 0,
    expression,
  }
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

export const createLabeledArg = (label: string, arg: Expr): LabeledArg => {
  return { label: createIdentifier(label), arg, type: 'LabeledArg' }
}
