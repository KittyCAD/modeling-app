import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'
import { toUtf16 } from '@src/lang/errors'
import { isArray } from '@src/lib/utils'

type ComponentDefinition = Extract<
  Program['body'][number],
  { type: 'VariableDeclaration' }
>

type ComponentInstanceOperation = Extract<Operation, { type: 'GroupBegin' }> & {
  group: Extract<
    Extract<Operation, { type: 'GroupBegin' }>['group'],
    { type: 'ComponentInstance' }
  >
}

type Replacement = {
  start: number
  end: number
  text: string
}

type DirectParamReference = {
  name: string
  start: number
  end: number
}

export function rewriteComponentParameterSketchSolveSource({
  ast,
  code,
  editedCode,
  operations,
  sketchId,
}: {
  ast: Node<Program>
  code: string
  editedCode: string
  operations: Operation[]
  sketchId: number
}): string | null {
  const replacement = singleReplacement(code, editedCode)
  if (!replacement) return null

  const instance = findComponentInstanceForSketchId(operations, sketchId)
  if (!instance) return null

  const definition = findComponentDefinition(ast, instance.group.name)
  if (!definition) return null

  const directParam = findDirectComponentParamReference({
    definition,
    code,
    replacement,
  })
  if (!directParam) return null

  const instanceArg = instance.group.labeledArgs[directParam.name]
  if (!instanceArg) return null

  if (instance.group.isDefault) {
    const [start, end] = utf16SourceRange(instanceArg.sourceRange, code)
    return replaceRange(code, start, end, replacement.text)
  }

  const [argStart, argEnd] = utf16SourceRange(instanceArg.sourceRange, code)
  const [definitionStart, definitionEnd] = utf16SourceRange(
    instance.group.definitionSourceRange,
    code
  )
  const argComesFromDefinition =
    argStart >= definitionStart && argEnd <= definitionEnd

  if (!argComesFromDefinition) {
    return replaceRange(code, argStart, argEnd, replacement.text)
  }

  return insertComponentOverrideArg({
    code,
    callSourceRange: instance.sourceRange,
    paramName: directParam.name,
    valueText: replacement.text,
  })
}

function singleReplacement(
  originalCode: string,
  editedCode: string
): Replacement | null {
  if (originalCode === editedCode) return null

  let start = 0
  const prefixLimit = Math.min(originalCode.length, editedCode.length)
  while (
    start < prefixLimit &&
    originalCode.charCodeAt(start) === editedCode.charCodeAt(start)
  ) {
    start++
  }

  let originalEnd = originalCode.length
  let editedEnd = editedCode.length
  while (
    originalEnd > start &&
    editedEnd > start &&
    originalCode.charCodeAt(originalEnd - 1) ===
      editedCode.charCodeAt(editedEnd - 1)
  ) {
    originalEnd--
    editedEnd--
  }

  return {
    start,
    end: originalEnd,
    text: editedCode.slice(start, editedEnd),
  }
}

function findComponentInstanceForSketchId(
  operations: Operation[],
  sketchId: number
): ComponentInstanceOperation | null {
  const stack: (ComponentInstanceOperation | null)[] = []

  for (const operation of operations) {
    if (operation.type === 'GroupBegin') {
      stack.push(
        operation.group.type === 'ComponentInstance'
          ? (operation as ComponentInstanceOperation)
          : null
      )
      continue
    }

    if (operation.type === 'GroupEnd') {
      stack.pop()
      continue
    }

    if (operation.type === 'SketchSolve' && operation.sketchId === sketchId) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]) return stack[i]
      }
      return null
    }
  }

  return null
}

function findComponentDefinition(
  ast: Node<Program>,
  componentName: string
): ComponentDefinition | null {
  const definition = ast.body.find(
    (item): item is ComponentDefinition =>
      item.type === 'VariableDeclaration' &&
      item.declaration.id.name === componentName &&
      item.declaration.init.type === 'ComponentBlock'
  )

  return definition ?? null
}

function findDirectComponentParamReference({
  definition,
  code,
  replacement,
}: {
  definition: ComponentDefinition
  code: string
  replacement: Replacement
}): DirectParamReference | null {
  if (definition.declaration.init.type !== 'ComponentBlock') return null

  const component = definition.declaration.init
  const paramNames = new Set(
    component.arguments.flatMap((arg) => (arg.label ? [arg.label.name] : []))
  )
  const originalText = code.slice(replacement.start, replacement.end).trim()
  if (!paramNames.has(originalText)) return null

  let directReference: DirectParamReference | null = null
  visit(component.body, (node) => {
    if (directReference || !isNameNode(node)) return
    const name = node.name.name
    if (name !== originalText) return
    if (node.start !== replacement.start || node.end !== replacement.end) {
      return
    }

    directReference = {
      name,
      start: node.start,
      end: node.end,
    }
  })

  return directReference
}

function isNameNode(value: unknown): value is {
  type: 'Name'
  start: number
  end: number
  name: { name: string }
} {
  if (!value || typeof value !== 'object') return false
  const node = value as {
    type?: unknown
    start?: unknown
    end?: unknown
    name?: unknown
  }

  return (
    node.type === 'Name' &&
    typeof node.start === 'number' &&
    typeof node.end === 'number' &&
    typeof (node.name as { name?: unknown } | undefined)?.name === 'string'
  )
}

function visit(value: unknown, onNode: (node: unknown) => void) {
  if (!value || typeof value !== 'object') return
  onNode(value)

  if (isArray(value)) {
    value.forEach((child) => visit(child, onNode))
    return
  }

  for (const [key, child] of Object.entries(value)) {
    if (
      key === 'moduleId' ||
      key === 'outerAttrs' ||
      key === 'preComments' ||
      key === 'nonCodeMeta' ||
      key === 'digest'
    ) {
      continue
    }
    visit(child, onNode)
  }
}

function insertComponentOverrideArg({
  code,
  callSourceRange,
  paramName,
  valueText,
}: {
  code: string
  callSourceRange: SourceRange
  paramName: string
  valueText: string
}): string | null {
  const [callStart, callEnd] = utf16SourceRange(callSourceRange, code)
  const openParen = code.indexOf('(', callStart)
  const closeParen = code.lastIndexOf(')', callEnd)
  if (openParen < callStart || closeParen < openParen) return null

  const callSource = code.slice(callStart, callEnd)
  const insertion = `${paramName} = ${valueText}`
  if (!callSource.includes('\n')) {
    const hasExistingArgs = code.slice(openParen + 1, closeParen).trim() !== ''
    return replaceRange(
      code,
      closeParen,
      closeParen,
      `${hasExistingArgs ? ', ' : ''}${insertion}`
    )
  }

  const previousIndex = previousNonWhitespaceIndex(code, closeParen)
  const needsComma = previousIndex > openParen && code[previousIndex] !== ','
  const closeLineStart = code.lastIndexOf('\n', closeParen - 1) + 1
  const closeIndent = code.slice(closeLineStart, closeParen).match(/^\s*/)?.[0]
  const parameterIndent = `${closeIndent ?? ''}  `
  const withComma = needsComma
    ? replaceRange(code, previousIndex + 1, previousIndex + 1, ',')
    : code
  const adjustedCloseLineStart = needsComma
    ? closeLineStart + 1
    : closeLineStart

  return replaceRange(
    withComma,
    adjustedCloseLineStart,
    adjustedCloseLineStart,
    `${parameterIndent}${insertion},\n`
  )
}

function replaceRange(
  code: string,
  start: number,
  end: number,
  replacement: string
) {
  return code.slice(0, start) + replacement + code.slice(end)
}

function previousNonWhitespaceIndex(code: string, index: number) {
  for (let i = index - 1; i >= 0; i--) {
    if (!/\s/.test(code[i])) return i
  }
  return -1
}

function utf16SourceRange(range: SourceRange, code: string): [number, number] {
  return [toUtf16(range[0], code), toUtf16(range[1], code)]
}
