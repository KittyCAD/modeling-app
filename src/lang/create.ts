import type { ImportStatement } from '@rust/kcl-lib/bindings/ImportStatement'
import type { Name } from '@rust/kcl-lib/bindings/Name'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { type NonCodeMeta } from '@rust/kcl-lib/bindings/NonCodeMeta'
import type { TagDeclarator } from '@rust/kcl-lib/bindings/TagDeclarator'

import type { ImportPath } from '@rust/kcl-lib/bindings/ImportPath'
import type { ImportSelector } from '@rust/kcl-lib/bindings/ImportSelector'
import type { ItemVisibility } from '@rust/kcl-lib/bindings/ItemVisibility'
import {
  type ArrayExpression,
  type BinaryExpression,
  type CallExpressionKw,
  type Expr,
  type ExpressionStatement,
  type Identifier,
  type LabeledArg,
  type Literal,
  type NumericSuffix,
  type ObjectExpression,
  type PipeExpression,
  type PipeSubstitution,
  type Program,
  type UnaryExpression,
  type VariableDeclaration,
  type VariableDeclarator,
  formatNumberLiteral,
} from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

/**
 * Note: This depends on WASM, but it's not async.  Callers are responsible for
 * awaiting init of the WASM module.
 */
export function createLiteral(
  value: number | string | boolean,
  suffix?: NumericSuffix,
  wasmInstance?: ModuleType
): Node<Literal> {
  // TODO: Should we handle string escape sequences?
  return {
    type: 'Literal',
    start: 0,
    end: 0,
    moduleId: 0,
    value:
      typeof value === 'number'
        ? { value, suffix: suffix ? suffix : 'None' }
        : value,
    raw: createRawStr(value, suffix, wasmInstance),
    outerAttrs: [],
    preComments: [],
    commentStart: 0,
  }
}

function createRawStr(
  value: number | string | boolean,
  suffix?: NumericSuffix,
  wasmInstance?: ModuleType
): string {
  if (typeof value !== 'number' || !suffix) {
    return `${value}`
  }

  const formatted = formatNumberLiteral(value, suffix, wasmInstance)
  if (err(formatted)) {
    return `${value}`
  }

  return formatted
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

export const createLabeledArg = (label: string, arg: Expr): LabeledArg => {
  return { label: createIdentifier(label), arg, type: 'LabeledArg' }
}
