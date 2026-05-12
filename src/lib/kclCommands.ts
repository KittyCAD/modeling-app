import type { UnitLength } from '@kittycad/lib'
import toast from 'react-hot-toast'

import type { BodyItem } from '@rust/kcl-lib/bindings/BodyItem'
import type { ComponentBlock } from '@rust/kcl-lib/bindings/ComponentBlock'
import type { Expr } from '@rust/kcl-lib/bindings/Expr'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import type { KclManager } from '@src/lang/KclManager'
import { updateModelingState } from '@src/lang/modelingWorkflows'
import {
  addModuleImport,
  insertVariableAndOffsetPathToNode,
} from '@src/lang/modifyAst'
import { setExperimentalFeatures } from '@src/lang/modifyAst/settings'
import { getNodeFromPath } from '@src/lang/queryAst'
import { getVariableDeclaration } from '@src/lang/queryAst/getVariableDeclaration'
import {
  type PathToNode,
  type VariableDeclarator,
  changeDefaultUnits,
  isPathToNode,
  pathToNodeFromRustNodePath,
  recast,
} from '@src/lang/wasm'
import { relevantFileExtensions } from '@src/lang/wasmUtils'
import type {
  Command,
  CommandArgument,
  CommandArgumentOption,
  KclCommandValue,
} from '@src/lib/commandTypes'
import {
  DEFAULT_DEFAULT_LENGTH_UNIT,
  DEFAULT_EXPERIMENTAL_FEATURES,
  EXECUTION_TYPE_REAL,
} from '@src/lib/constants'
import { getPathFilenameInVariableCase } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import { isDesktop } from '@src/lib/isDesktop'
import { copyFileShareLink } from '@src/lib/links'
import type { Project } from '@src/lib/project'
import { baseUnitsUnion, warningLevels } from '@src/lib/settings/settingsTypes'
import { err, reportRejection } from '@src/lib/trap'
import type { IndexLoaderData } from '@src/lib/types'
import { isArray } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import { listAllImportFilesWithinProject } from '@src/machines/systemIO/snapshotContext'
import type { SystemIOActor } from '@src/machines/systemIO/utils'

interface KclCommandConfig {
  // TODO: find a different approach that doesn't require
  // special props for a single command
  specialPropsForInsertCommand: {
    providedOptions: CommandArgumentOption<string>[]
  }
  kclManager: KclManager
  systemIOActor: SystemIOActor
  wasmInstance: ModuleType
  projectData: IndexLoaderData
  authToken: string
  settings: {
    defaultUnit: UnitLength
  }
  isRestrictedToOrg?: boolean
  password?: string
  project?: Project
}

const NO_INPUT_PROVIDED_MESSAGE = 'No input provided'
const EXECUTING_MESSAGE =
  'Cannot run command while code is executing. Please try again later.'
const INSERT_FILE_PREFIX = 'file:'
const INSERT_COMPONENT_PREFIX = 'component:'

type ComponentParam = {
  name: string
  defaultCode: string
}

type ComponentDefinition = {
  name: string
  params: ComponentParam[]
}

export type ComponentKclValueOption = {
  start: number
  end: number
  valueText: string
}

type ComponentParameterOption = {
  name: string
}

function isComponentParameterOption(
  value: unknown
): value is ComponentParameterOption {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { name?: unknown }).name === 'string'
  )
}

const PARAMETERIZABLE_COMPONENT_EXPR_TYPES = new Set<Expr['type']>([
  'Literal',
  'Name',
  'TagDeclarator',
  'BinaryExpression',
  'PipeSubstitution',
  'ArrayExpression',
  'ArrayRangeExpression',
  'ObjectExpression',
  'MemberExpression',
  'UnaryExpression',
  'IfExpression',
  'LabelledExpression',
  'AscribedExpression',
  'SketchVar',
])

function topLevelNameExists(ast: Node<Program>, name: string): boolean {
  return ast.body.some(
    (item) =>
      item.type === 'VariableDeclaration' && item.declaration.id.name === name
  )
}

function variableNameExists(kclManager: KclManager, name: string): boolean {
  return topLevelNameExists(kclManager.ast, name)
}

function isValidKclIdentifier(name: string) {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)
}

function nextAvailableVariableName(kclManager: KclManager, baseName: string) {
  if (!variableNameExists(kclManager, baseName)) return baseName

  let index = 2
  while (variableNameExists(kclManager, `${baseName}${index}`)) {
    index++
  }
  return `${baseName}${index}`
}

function componentDefinitions(kclManager: KclManager): ComponentDefinition[] {
  return kclManager.ast.body.flatMap((item) => {
    if (
      item.type !== 'VariableDeclaration' ||
      item.declaration.init.type !== 'ComponentBlock'
    ) {
      return []
    }

    const params = item.declaration.init.arguments.flatMap((arg) => {
      if (!arg.label) return []
      return {
        name: arg.label.name,
        defaultCode: kclManager.code.slice(arg.arg.start, arg.arg.end),
      }
    })
    return {
      name: item.declaration.id.name,
      params,
    }
  })
}

function findComponentDefinition(
  ast: Node<Program>,
  componentName: string
): BodyItem | undefined {
  return ast.body.find(
    (item) =>
      item.type === 'VariableDeclaration' &&
      item.declaration.id.name === componentName &&
      item.declaration.init.type === 'ComponentBlock'
  )
}

function isExpressionNode(node: unknown): node is Expr {
  if (!node || typeof node !== 'object') return false
  const maybeNode = node as { type?: unknown; start?: unknown; end?: unknown }
  return (
    typeof maybeNode.type === 'string' &&
    PARAMETERIZABLE_COMPONENT_EXPR_TYPES.has(maybeNode.type as Expr['type']) &&
    typeof maybeNode.start === 'number' &&
    typeof maybeNode.end === 'number'
  )
}

function componentLineContext(
  code: string,
  option: ComponentKclValueOption
): string {
  const lineStart = code.lastIndexOf('\n', option.start - 1) + 1
  const lineEndIndex = code.indexOf('\n', option.end)
  const lineEnd = lineEndIndex === -1 ? code.length : lineEndIndex
  const before = code.slice(lineStart, option.start).trimStart()
  const after = code.slice(option.end, lineEnd).trimEnd()
  return `${before}[[${option.valueText}]]${after}`
}

function indentationAt(code: string, index: number) {
  const lineStart = code.lastIndexOf('\n', index - 1) + 1
  const match = code.slice(lineStart, index).match(/^\s*/)
  return match?.[0] ?? ''
}

function previousNonWhitespaceIndex(code: string, index: number) {
  for (let i = index - 1; i >= 0; i--) {
    if (!/\s/.test(code[i])) return i
  }
  return -1
}

export function componentKclValueOptionsForAst(
  ast: Node<Program>,
  code: string,
  componentName: string
): ComponentKclValueOption[] {
  const definition = findComponentDefinition(ast, componentName)
  if (
    !definition ||
    definition.type !== 'VariableDeclaration' ||
    definition.declaration.init.type !== 'ComponentBlock'
  ) {
    return []
  }

  const component = definition.declaration.init
  const seenRanges = new Set<string>()
  const options: ComponentKclValueOption[] = []

  function visit(value: unknown, parentKey?: string) {
    if (!value || typeof value !== 'object') return
    if (isArray(value)) {
      value.forEach((child) => visit(child, parentKey))
      return
    }

    if (
      parentKey !== 'callee' &&
      isExpressionNode(value) &&
      value.start >= component.body.start &&
      value.end <= component.body.end
    ) {
      const key = `${value.start}:${value.end}`
      const valueText = code.slice(value.start, value.end)
      if (valueText.trim().length > 0 && !seenRanges.has(key)) {
        seenRanges.add(key)
        options.push({
          start: value.start,
          end: value.end,
          valueText,
        })
      }
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
      visit(child, key)
    }
  }

  visit(component.body)

  return options.sort((left, right) => {
    if (left.start !== right.start) return left.start - right.start
    return right.end - left.end
  })
}

function componentKclValueOptions(
  kclManager: KclManager,
  componentName: string
): CommandArgumentOption<ComponentKclValueOption>[] {
  return componentKclValueOptionsForAst(
    kclManager.ast,
    kclManager.code,
    componentName
  ).map((option) => ({
    name: componentLineContext(kclManager.code, option),
    value: option,
  }))
}

function componentParameterOptions(
  components: ComponentDefinition[],
  componentName: string
): CommandArgumentOption<ComponentParameterOption>[] {
  return (
    components
      .find((component) => component.name === componentName)
      ?.params.map((param) => ({
        name: param.name,
        value: { name: param.name },
      })) ?? []
  )
}

type SourceInsertion = {
  index: number
  text: string
}

function addComponentParameterInsertions(
  code: string,
  componentStart: number,
  bodyStart: number,
  hasExistingParams: boolean,
  parameterName: string,
  parameterValue: string
): SourceInsertion[] | Error {
  const closeParenIndex = code.lastIndexOf(')', bodyStart)
  if (closeParenIndex < componentStart) {
    return new Error('Could not find the component parameter list.')
  }

  const signatureSource = code.slice(componentStart, closeParenIndex)
  const isMultiline = signatureSource.includes('\n')
  if (!isMultiline) {
    const prefix = hasExistingParams ? ', ' : ''
    return [
      {
        index: closeParenIndex,
        text: `${prefix}${parameterName} = ${parameterValue}`,
      },
    ]
  }

  const closeLineStart = code.lastIndexOf('\n', closeParenIndex - 1) + 1
  const closeIndent = indentationAt(code, closeParenIndex)
  const parameterIndent = `${closeIndent}  `
  const previousIndex = previousNonWhitespaceIndex(code, closeParenIndex)
  const needsComma = hasExistingParams && code[previousIndex] !== ','
  return [
    ...(needsComma ? [{ index: previousIndex + 1, text: ',' }] : []),
    {
      index: closeLineStart,
      text: `${parameterIndent}${parameterName} = ${parameterValue},\n`,
    },
  ]
}

export function addParameterToComponentSource({
  ast,
  code,
  componentName,
  value,
  parameterName,
}: {
  ast: Node<Program>
  code: string
  componentName: string
  value: ComponentKclValueOption
  parameterName: string
}): string | Error {
  const definition = findComponentDefinition(ast, componentName)
  if (
    !definition ||
    definition.type !== 'VariableDeclaration' ||
    definition.declaration.init.type !== 'ComponentBlock'
  ) {
    return new Error(`Could not find component ${componentName}.`)
  }

  if (!isValidKclIdentifier(parameterName)) {
    return new Error('Parameter name must be a valid KCL identifier.')
  }

  const component = definition.declaration.init
  if (component.arguments.some((arg) => arg.label?.name === parameterName)) {
    return new Error(`A parameter named ${parameterName} already exists.`)
  }

  const currentOptions = componentKclValueOptionsForAst(
    ast,
    code,
    componentName
  )
  const selectedValue =
    currentOptions.find(
      (option) =>
        option.start === value.start &&
        option.end === value.end &&
        option.valueText === value.valueText
    ) ?? currentOptions.find((option) => option.valueText === value.valueText)

  if (!selectedValue) {
    return new Error(`Could not find ${value.valueText} in ${componentName}.`)
  }

  const parameterInsertions = addComponentParameterInsertions(
    code,
    component.start,
    component.body.start,
    component.arguments.length > 0,
    parameterName,
    selectedValue.valueText
  )
  if (parameterInsertions instanceof Error) {
    return parameterInsertions
  }

  let newCode =
    code.slice(0, selectedValue.start) +
    parameterName +
    code.slice(selectedValue.end)

  for (const insertion of [...parameterInsertions].sort(
    (left, right) => right.index - left.index
  )) {
    newCode =
      newCode.slice(0, insertion.index) +
      insertion.text +
      newCode.slice(insertion.index)
  }

  return newCode
}

function isNameReferenceNode(value: unknown): value is {
  type: 'Name'
  start: number
  end: number
  name: { name: string }
} {
  if (!value || typeof value !== 'object') return false
  const maybeNode = value as {
    type?: unknown
    start?: unknown
    end?: unknown
    name?: unknown
  }
  return (
    maybeNode.type === 'Name' &&
    typeof maybeNode.start === 'number' &&
    typeof maybeNode.end === 'number' &&
    typeof (maybeNode.name as { name?: unknown } | undefined)?.name === 'string'
  )
}

function visitAst(
  value: unknown,
  visitor: (value: unknown, parentKey?: string) => void,
  parentKey?: string
) {
  if (!value || typeof value !== 'object') return
  visitor(value, parentKey)

  if (isArray(value)) {
    value.forEach((child) => visitAst(child, visitor, parentKey))
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
    visitAst(child, visitor, key)
  }
}

function collectDirectParameterReferenceRanges(
  componentBody: unknown,
  parameterName: string
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  visitAst(componentBody, (value, parentKey) => {
    if (
      parentKey === 'callee' ||
      parentKey === 'property' ||
      !isNameReferenceNode(value) ||
      value.name.name !== parameterName
    ) {
      return
    }

    ranges.push({ start: value.start, end: value.end })
  })
  return ranges
}

function removeSourceRangeForLabeledArg({
  code,
  labelStart,
  argEnd,
  listStart,
  listEnd,
}: {
  code: string
  labelStart: number
  argEnd: number
  listStart: number
  listEnd: number
}): { start: number; end: number; replacement: string } {
  const listSource = code.slice(listStart, listEnd)
  const isMultiline = listSource.includes('\n')

  if (isMultiline) {
    const lineStart = code.lastIndexOf('\n', labelStart - 1) + 1
    const nextLineStartIndex = code.indexOf('\n', argEnd)
    const lineEnd = nextLineStartIndex === -1 ? argEnd : nextLineStartIndex + 1
    return { start: lineStart, end: lineEnd, replacement: '' }
  }

  const previousIndex = previousNonWhitespaceIndex(code, labelStart)
  const nextIndex = nextNonWhitespaceIndex(code, argEnd)

  if (nextIndex !== -1 && nextIndex < listEnd && code[nextIndex] === ',') {
    const afterComma = nextNonWhitespaceIndex(code, nextIndex + 1)
    return {
      start: labelStart,
      end: afterComma === -1 ? nextIndex + 1 : afterComma,
      replacement: '',
    }
  }

  if (
    previousIndex !== -1 &&
    previousIndex > listStart &&
    code[previousIndex] === ','
  ) {
    return { start: previousIndex, end: argEnd, replacement: '' }
  }

  return { start: labelStart, end: argEnd, replacement: '' }
}

function nextNonWhitespaceIndex(code: string, index: number) {
  for (let i = index; i < code.length; i++) {
    if (!/\s/.test(code[i])) return i
  }
  return -1
}

function signatureCloseParenIndex(
  code: string,
  component: Node<ComponentBlock>
) {
  return code.lastIndexOf(')', component.body.start)
}

function editsToSource(
  code: string,
  edits: Array<{ start: number; end: number; replacement: string }>
) {
  let nextCode = code
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    nextCode =
      nextCode.slice(0, edit.start) +
      edit.replacement +
      nextCode.slice(edit.end)
  }
  return nextCode
}

export function deleteParameterFromComponentSource({
  ast,
  code,
  componentName,
  parameterName,
}: {
  ast: Node<Program>
  code: string
  componentName: string
  parameterName: string
}): string | Error {
  const definition = findComponentDefinition(ast, componentName)
  if (
    !definition ||
    definition.type !== 'VariableDeclaration' ||
    definition.declaration.init.type !== 'ComponentBlock'
  ) {
    return new Error(`Could not find component ${componentName}.`)
  }

  const component = definition.declaration.init
  const parameter = component.arguments.find(
    (arg) => arg.label?.name === parameterName
  )
  if (!parameter?.label) {
    return new Error(`Could not find parameter ${parameterName}.`)
  }

  const signatureEnd = signatureCloseParenIndex(code, component)
  if (signatureEnd < component.start) {
    return new Error('Could not find the component parameter list.')
  }

  const defaultValue = code.slice(parameter.arg.start, parameter.arg.end)
  const edits: Array<{ start: number; end: number; replacement: string }> = [
    removeSourceRangeForLabeledArg({
      code,
      labelStart: parameter.label.start,
      argEnd: parameter.arg.end,
      listStart: component.start,
      listEnd: signatureEnd,
    }),
    ...collectDirectParameterReferenceRanges(component.body, parameterName).map(
      (range) => ({
        ...range,
        replacement: defaultValue,
      })
    ),
  ]

  visitAst(ast, (value) => {
    if (
      !value ||
      typeof value !== 'object' ||
      (value as { type?: unknown }).type !== 'CallExpressionKw'
    ) {
      return
    }
    const call = value as Extract<Expr, { type: 'CallExpressionKw' }>
    if (call.callee.name.name !== componentName) {
      return
    }

    const arg = call.arguments.find(
      (candidate) => candidate.label?.name === parameterName
    )
    if (!arg?.label) {
      return
    }

    if (call.arguments.length === 1 && call.unlabeled === null) {
      edits.push({
        start: call.start,
        end: call.end,
        replacement: `clone(${componentName})`,
      })
      return
    }

    edits.push(
      removeSourceRangeForLabeledArg({
        code,
        labelStart: arg.label.start,
        argEnd: arg.arg.end,
        listStart: call.start,
        listEnd: call.end,
      })
    )
  })

  return editsToSource(code, edits)
}

export function renameParameterInComponentSource({
  ast,
  code,
  componentName,
  parameterName,
  newParameterName,
}: {
  ast: Node<Program>
  code: string
  componentName: string
  parameterName: string
  newParameterName: string
}): string | Error {
  const definition = findComponentDefinition(ast, componentName)
  if (
    !definition ||
    definition.type !== 'VariableDeclaration' ||
    definition.declaration.init.type !== 'ComponentBlock'
  ) {
    return new Error(`Could not find component ${componentName}.`)
  }
  if (!isValidKclIdentifier(newParameterName)) {
    return new Error('Parameter name must be a valid KCL identifier.')
  }

  const component = definition.declaration.init
  const parameter = component.arguments.find(
    (arg) => arg.label?.name === parameterName
  )
  if (!parameter?.label) {
    return new Error(`Could not find parameter ${parameterName}.`)
  }
  if (
    component.arguments.some((arg) => arg.label?.name === newParameterName) ||
    topLevelNameExists(ast, newParameterName)
  ) {
    return new Error('This variable name is already in use.')
  }

  const edits: Array<{ start: number; end: number; replacement: string }> = [
    {
      start: parameter.label.start,
      end: parameter.label.end,
      replacement: newParameterName,
    },
    ...collectDirectParameterReferenceRanges(component.body, parameterName).map(
      (range) => ({
        ...range,
        replacement: newParameterName,
      })
    ),
  ]

  visitAst(ast, (value) => {
    if (
      !value ||
      typeof value !== 'object' ||
      (value as { type?: unknown }).type !== 'CallExpressionKw'
    ) {
      return
    }
    const call = value as Extract<Expr, { type: 'CallExpressionKw' }>
    if (call.callee.name.name !== componentName) {
      return
    }

    const arg = call.arguments.find(
      (candidate) => candidate.label?.name === parameterName
    )
    if (!arg?.label) {
      return
    }

    edits.push({
      start: arg.label.start,
      end: arg.label.end,
      replacement: newParameterName,
    })
  })

  return editsToSource(code, edits)
}

function selectedTopLevelBodyItems(kclManager: KclManager): BodyItem[] {
  const selectedRanges = kclManager.selectionRanges.graphSelections.flatMap(
    (selection) => {
      const range = selection.codeRef.range
      if (range[0] === undefined || range[1] === undefined) return []
      return [[range[0], range[1]] as const]
    }
  )

  return kclManager.ast.body.filter((item) =>
    selectedRanges.some(
      ([start, end]) => item.start <= start && item.end >= end
    )
  )
}

function createComponentFromSelection(
  kclManager: KclManager,
  componentName: string
): string | Error {
  if (variableNameExists(kclManager, componentName)) {
    return new Error(`A variable named ${componentName} already exists.`)
  }

  const selectedItems = selectedTopLevelBodyItems(kclManager)
  if (selectedItems.length === 0) {
    return new Error('Select one or more top-level operations first.')
  }

  const bodyIndexes = selectedItems.map((item) =>
    kclManager.ast.body.findIndex((candidate) => candidate === item)
  )
  const minIndex = Math.min(...bodyIndexes)
  const maxIndex = Math.max(...bodyIndexes)
  if (maxIndex - minIndex + 1 !== selectedItems.length) {
    return new Error(
      'Create Component currently requires a contiguous selection.'
    )
  }

  const orderedItems = [...selectedItems].sort(
    (left, right) => left.start - right.start
  )
  const lastItem = orderedItems[orderedItems.length - 1]
  if (lastItem.type !== 'VariableDeclaration') {
    return new Error(
      'The last selected operation must assign a value that can be returned.'
    )
  }

  const returnName = lastItem.declaration.id.name
  const bodyCode = orderedItems
    .map((item) => kclManager.code.slice(item.start, item.end))
    .join('\n')
    .split('\n')
    .map((line) => (line.length > 0 ? `  ${line}` : line))
    .join('\n')
  const replacement = `${componentName} = component() {\n${bodyCode}\n  return ${returnName}\n}`
  const start = orderedItems[0].start
  const end = orderedItems[orderedItems.length - 1].end
  return (
    kclManager.code.slice(0, start) + replacement + kclManager.code.slice(end)
  )
}

function insertComponentInstanceSource(
  localName: string,
  component: ComponentDefinition,
  overrides: Record<string, KclCommandValue | undefined>
) {
  const overrideArgs = component.params.flatMap((param) => {
    const override = overrides[param.name]
    if (!override || override.valueText.trim() === param.defaultCode.trim()) {
      return []
    }
    return `${param.name} = ${override.valueText}`
  })
  const expression =
    overrideArgs.length > 0
      ? `${component.name}(${overrideArgs.join(', ')})`
      : `clone(${component.name})`

  return `${localName} = ${expression}`
}

export function kclCommands(commandProps: KclCommandConfig): Command[] {
  const components = componentDefinitions(commandProps.kclManager)
  const componentOverrideArgs = Object.fromEntries(
    components.flatMap((component) =>
      component.params.map((param) => [
        `componentOverride:${component.name}:${param.name}`,
        {
          displayName: param.name,
          inputType: 'kcl',
          required: false,
          skip: false,
          hidden: (context: { argumentsToSubmit: Record<string, unknown> }) =>
            context.argumentsToSubmit.target !==
            `${INSERT_COMPONENT_PREFIX}${component.name}`,
          defaultValue: param.defaultCode,
          createVariable: 'disallow',
        } satisfies CommandArgument<KclCommandValue>,
      ])
    )
  )

  return [
    {
      name: 'set-file-units',
      displayName: 'Set file units',
      description:
        'Set the length unit for all dimensions not given explicit units in the current file.',
      needsReview: false,
      groupId: 'code',
      icon: 'code',
      args: {
        unit: {
          required: true,
          inputType: 'options',
          defaultValue:
            commandProps.kclManager.fileSettings.defaultLengthUnit ||
            DEFAULT_DEFAULT_LENGTH_UNIT,
          options: () =>
            Object.values(baseUnitsUnion).map((v) => {
              return {
                name: v,
                value: v,
                isCurrent: commandProps.kclManager.fileSettings
                  .defaultLengthUnit
                  ? v === commandProps.kclManager.fileSettings.defaultLengthUnit
                  : v === DEFAULT_DEFAULT_LENGTH_UNIT,
              }
            }),
        },
      },
      onSubmit: (data) => {
        if (typeof data === 'object' && 'unit' in data) {
          const newCode = changeDefaultUnits(
            commandProps.kclManager.code,
            data.unit,
            commandProps.wasmInstance
          )
          if (err(newCode)) {
            toast.error(`Failed to set per-file units: ${newCode.message}`)
          } else {
            commandProps.kclManager.updateCodeEditor(newCode, {
              shouldExecute: true,
              shouldResetCamera: true,
            })
            toast.success(`Updated per-file units to ${data.unit}.`)
          }
        } else {
          toast.error(
            'Failed to set per-file units: no value provided to submit function. This is a bug.'
          )
        }
      },
    },
    {
      name: 'set-file-experimental-features',
      displayName: 'Set experimental features flag',
      description: 'Set the experimental features flag in the current file.',
      needsReview: false,
      groupId: 'code',
      icon: 'code',
      args: {
        level: {
          required: true,
          inputType: 'options',
          defaultValue:
            commandProps.kclManager.fileSettings.experimentalFeatures?.type ||
            DEFAULT_EXPERIMENTAL_FEATURES.type,
          options: () =>
            warningLevels.map((l) => {
              return {
                name: l.type,
                value: l.type,
                isCurrent: commandProps.kclManager.fileSettings
                  .experimentalFeatures
                  ? l.type ===
                    commandProps.kclManager.fileSettings.experimentalFeatures
                      .type
                  : l.type === DEFAULT_EXPERIMENTAL_FEATURES.type,
              }
            }),
        },
      },
      onSubmit: (data) => {
        awaitWasmAndSubmit().catch(reportRejection)

        async function awaitWasmAndSubmit() {
          if (typeof data === 'object' && 'level' in data) {
            const newAst = setExperimentalFeatures(
              commandProps.kclManager.code,
              {
                type: data.level,
              },
              await commandProps.kclManager.wasmInstancePromise
            )
            if (err(newAst)) {
              toast.error(
                `Failed to set file experimental features level: ${newAst.message}`
              )
              return
            }
            updateModelingState(
              newAst,
              EXECUTION_TYPE_REAL,
              commandProps.kclManager
            )
              .then((result) => {
                if (err(result)) {
                  toast.error(
                    `Failed to set file experimental features level: ${result.message}`
                  )
                  return
                }

                toast.success(
                  `Updated file experimental features level to ${data.level}.`
                )
              })
              .catch(reportRejection)
          } else {
            toast.error(
              'Failed to set experimental features level: no value provided to submit function. This is a bug.'
            )
          }
        }
      },
    },
    {
      name: 'Insert',
      description:
        'Insert a component from this file or a file from the current project directory',
      icon: 'import',
      groupId: 'code',
      needsReview: true,
      reviewValidation: async () => {
        if (commandProps.kclManager.isExecuting) {
          return new Error(EXECUTING_MESSAGE)
        }
      },
      args: {
        target: {
          inputType: 'options',
          required: true,
          options: () => {
            const providedOptions: { name: string; value: string }[] =
              components.map((component) => ({
                name: `Component: ${component.name}`,
                value: `${INSERT_COMPONENT_PREFIX}${component.name}`,
              }))

            if (!isDesktop()) {
              return providedOptions
            }

            const context = commandProps.systemIOActor.getSnapshot().context
            const projectName = commandProps.project?.name
            const sep = fsZds.sep
            const relevantFiles = relevantFileExtensions(
              commandProps.wasmInstance
            )
            if (projectName && sep) {
              const importableFiles = listAllImportFilesWithinProject(context, {
                projectFolderName: projectName,
                importExtensions: relevantFiles,
              })
              importableFiles.forEach((file) => {
                providedOptions.push({
                  name: `File: ${file.replaceAll(sep, '/')}`,
                  value: `${INSERT_FILE_PREFIX}${file.replaceAll(sep, '/')}`,
                })
              })
            }
            return providedOptions
          },
          validation: async ({ data }) => {
            if (typeof data !== 'string') {
              return 'Select a component or file to insert.'
            }
            if (data.startsWith(INSERT_COMPONENT_PREFIX)) {
              return true
            }
            const path = data.slice(INSERT_FILE_PREFIX.length)
            const importExists = commandProps.kclManager.ast.body.find(
              (n) =>
                n.type === 'ImportStatement' &&
                ((n.path.type === 'Kcl' && n.path.filename === path) ||
                  (n.path.type === 'Foreign' && n.path.path === path))
            )
            if (importExists) {
              return 'This file is already imported, use the Clone command instead.'
              // TODO: see if we can transition to the clone command, see #6515
            }

            return true
          },
        },
        localName: {
          inputType: 'string',
          required: true,
          defaultValue: (context: CommandBarContext) => {
            const target = context.argumentsToSubmit.target
            if (typeof target !== 'string') {
              return
            }

            if (target.startsWith(INSERT_COMPONENT_PREFIX)) {
              const componentName = target.slice(INSERT_COMPONENT_PREFIX.length)
              return nextAvailableVariableName(
                commandProps.kclManager,
                `${componentName}Instance`
              )
            }

            const path = target.slice(INSERT_FILE_PREFIX.length)
            return getPathFilenameInVariableCase(path)
          },
          validation: async ({ data }) => {
            const variableName =
              typeof data === 'string' ? data : data?.localName
            if (
              typeof variableName !== 'string' ||
              variableName.trim().length === 0
            ) {
              return 'Variable name is required.'
            }
            if (
              variableNameExists(commandProps.kclManager, variableName) ||
              commandProps.kclManager.variables['__mod_' + variableName]
            ) {
              return 'This variable name is already in use.'
            }

            return true
          },
        },
        ...componentOverrideArgs,
      },
      onSubmit: async (data) => {
        if (!data) {
          return new Error(NO_INPUT_PROVIDED_MESSAGE)
        }

        const { target, localName } = data
        if (typeof target !== 'string' || typeof localName !== 'string') {
          return new Error(NO_INPUT_PROVIDED_MESSAGE)
        }

        if (target.startsWith(INSERT_COMPONENT_PREFIX)) {
          const componentName = target.slice(INSERT_COMPONENT_PREFIX.length)
          const component = components.find(
            (component) => component.name === componentName
          )
          if (!component) {
            return new Error(`Could not find component ${componentName}.`)
          }

          const overrides: Record<string, KclCommandValue | undefined> = {}
          for (const param of component.params) {
            const key = `componentOverride:${component.name}:${param.name}`
            const override = data[key]
            if (
              override &&
              typeof override === 'object' &&
              'valueText' in override
            ) {
              overrides[param.name] = override as KclCommandValue
            }
          }

          const insertion = insertComponentInstanceSource(
            localName,
            component,
            overrides
          )
          const newCode = `${commandProps.kclManager.code.trimEnd()}\n${insertion}\n`
          const parsed = await commandProps.kclManager.safeParse(
            newCode,
            commandProps.kclManager.wasmInstancePromise
          )
          if (!parsed) {
            return new Error('Failed to insert component instance.')
          }

          commandProps.kclManager.updateCodeEditor(newCode, {
            shouldExecute: true,
            shouldWriteToDisk: true,
            shouldAddToHistory: true,
          })
          return
        }

        const ast = commandProps.kclManager.ast
        const path = target.slice(INSERT_FILE_PREFIX.length)
        const { modifiedAst, pathToNode } = addModuleImport({
          ast,
          path,
          localName,
        })
        updateModelingState(
          modifiedAst,
          EXECUTION_TYPE_REAL,
          commandProps.kclManager,
          {
            focusPath: [pathToNode],
            skipErrorsOnMockExecution: true,
          }
        ).catch(reportRejection)
      },
    },
    {
      name: 'component.create',
      displayName: 'Create Component',
      description: 'Wrap the selected top-level operation into a component.',
      icon: 'plus',
      groupId: 'code',
      needsReview: true,
      reviewValidation: async () => {
        if (commandProps.kclManager.isExecuting) {
          return new Error(EXECUTING_MESSAGE)
        }
      },
      args: {
        componentName: {
          inputType: 'string',
          required: true,
          defaultValue: () =>
            nextAvailableVariableName(commandProps.kclManager, 'myComponent'),
          validation: async ({ data }) => {
            if (typeof data !== 'string' || data.trim().length === 0) {
              return 'Component name is required.'
            }
            if (variableNameExists(commandProps.kclManager, data)) {
              return 'This variable name is already in use.'
            }
            return true
          },
        },
      },
      onSubmit: async (data) => {
        if (!data || typeof data.componentName !== 'string') {
          return new Error(NO_INPUT_PROVIDED_MESSAGE)
        }

        const newCode = createComponentFromSelection(
          commandProps.kclManager,
          data.componentName
        )
        if (newCode instanceof Error) {
          return newCode
        }
        const parsed = await commandProps.kclManager.safeParse(
          newCode,
          commandProps.kclManager.wasmInstancePromise
        )
        if (!parsed) {
          return new Error('Failed to create component from selection.')
        }

        commandProps.kclManager.updateCodeEditor(newCode, {
          shouldExecute: true,
          shouldWriteToDisk: true,
          shouldAddToHistory: true,
        })
      },
    },
    {
      name: 'component.addParameter',
      displayName: 'Add component parameter',
      description: 'Move a value from a component body into its parameters.',
      icon: 'make-variable',
      groupId: 'code',
      needsReview: false,
      args: {
        componentName: {
          displayName: 'Component',
          inputType: 'options',
          required: true,
          options: () =>
            components.map((component) => ({
              name: component.name,
              value: component.name,
            })),
          validation: async ({ data }) => {
            if (typeof data !== 'string') {
              return 'Select a component.'
            }
            if (!components.some((component) => component.name === data)) {
              return `Could not find component ${data}.`
            }
            return true
          },
        },
        value: {
          displayName: 'Value',
          inputType: 'options',
          required: true,
          valueSummary: (value: ComponentKclValueOption) => value.valueText,
          options: (context) => {
            const componentName = context.argumentsToSubmit.componentName
            if (typeof componentName !== 'string') {
              return []
            }
            return componentKclValueOptions(
              commandProps.kclManager,
              componentName
            )
          },
          validation: async ({ data }) => {
            if (
              !data ||
              typeof data !== 'object' ||
              typeof data.start !== 'number' ||
              typeof data.end !== 'number' ||
              typeof data.valueText !== 'string'
            ) {
              return 'Select a component value.'
            }
            return true
          },
        },
        parameterName: {
          displayName: 'Parameter name',
          inputType: 'string',
          required: true,
          defaultValue: 'myParameter',
          validation: async ({ data, context }) => {
            if (typeof data !== 'string' || data.trim().length === 0) {
              return 'Parameter name is required.'
            }
            if (!isValidKclIdentifier(data)) {
              return 'Parameter name must be a valid KCL identifier.'
            }
            const componentName = context.argumentsToSubmit.componentName
            if (typeof componentName !== 'string') {
              return 'Select a component first.'
            }
            const component = components.find(
              (component) => component.name === componentName
            )
            if (
              component?.params.some((param) => param.name === data) ||
              variableNameExists(commandProps.kclManager, data)
            ) {
              return 'This variable name is already in use.'
            }
            return true
          },
        },
      },
      onSubmit: async (data) => {
        if (!data) {
          return new Error(NO_INPUT_PROVIDED_MESSAGE)
        }
        const { componentName, value, parameterName } = data
        if (
          typeof componentName !== 'string' ||
          !value ||
          typeof value !== 'object' ||
          typeof value.start !== 'number' ||
          typeof value.end !== 'number' ||
          typeof value.valueText !== 'string' ||
          typeof parameterName !== 'string'
        ) {
          return new Error(NO_INPUT_PROVIDED_MESSAGE)
        }

        const freshAst = await commandProps.kclManager.safeParse(
          commandProps.kclManager.code,
          commandProps.kclManager.wasmInstancePromise
        )
        if (!freshAst) {
          return new Error('Current code could not be parsed.')
        }

        const newCode = addParameterToComponentSource({
          ast: freshAst,
          code: commandProps.kclManager.code,
          componentName,
          value,
          parameterName,
        })
        if (newCode instanceof Error) {
          return newCode
        }

        const parsed = await commandProps.kclManager.safeParse(
          newCode,
          commandProps.kclManager.wasmInstancePromise
        )
        if (!parsed) {
          return new Error('Failed to add component parameter.')
        }

        commandProps.kclManager.updateCodeEditor(newCode, {
          shouldExecute: true,
          shouldWriteToDisk: true,
          shouldAddToHistory: true,
        })
      },
    },
    {
      name: 'component.renameParameter',
      displayName: 'Rename component parameter',
      description: 'Rename a component parameter and its direct uses.',
      icon: 'make-variable',
      groupId: 'code',
      needsReview: false,
      args: {
        componentName: {
          displayName: 'Component',
          inputType: 'options',
          required: true,
          options: () =>
            components.map((component) => ({
              name: component.name,
              value: component.name,
            })),
          validation: async ({ data }) => {
            if (typeof data !== 'string') {
              return 'Select a component.'
            }
            if (!components.some((component) => component.name === data)) {
              return `Could not find component ${data}.`
            }
            return true
          },
        },
        parameterName: {
          displayName: 'Parameter',
          inputType: 'options',
          required: true,
          valueSummary: (value: ComponentParameterOption) => value.name,
          options: (context) => {
            const componentName = context.argumentsToSubmit.componentName
            if (typeof componentName !== 'string') {
              return []
            }
            return componentParameterOptions(components, componentName)
          },
          validation: async ({ data }) => {
            if (!isComponentParameterOption(data)) {
              return 'Select a component parameter.'
            }
            return true
          },
        },
        newParameterName: {
          displayName: 'New parameter name',
          inputType: 'string',
          required: true,
          defaultValue: 'myParameter',
          validation: async ({ data, context }) => {
            if (typeof data !== 'string' || data.trim().length === 0) {
              return 'Parameter name is required.'
            }
            if (!isValidKclIdentifier(data)) {
              return 'Parameter name must be a valid KCL identifier.'
            }
            const componentName = context.argumentsToSubmit.componentName
            const parameter = context.argumentsToSubmit.parameterName
            if (typeof componentName !== 'string') {
              return 'Select a component first.'
            }
            if (!isComponentParameterOption(parameter)) {
              return 'Select a parameter first.'
            }
            const component = components.find(
              (component) => component.name === componentName
            )
            if (component?.params.some((param) => param.name === data)) {
              return 'This parameter name is already in use.'
            }
            if (variableNameExists(commandProps.kclManager, data)) {
              return 'This variable name is already in use.'
            }
            return true
          },
        },
      },
      onSubmit: async (data) => {
        if (!data) {
          return new Error(NO_INPUT_PROVIDED_MESSAGE)
        }
        const { componentName, parameterName, newParameterName } = data
        if (
          typeof componentName !== 'string' ||
          !isComponentParameterOption(parameterName) ||
          typeof newParameterName !== 'string'
        ) {
          return new Error(NO_INPUT_PROVIDED_MESSAGE)
        }

        const freshAst = await commandProps.kclManager.safeParse(
          commandProps.kclManager.code,
          commandProps.kclManager.wasmInstancePromise
        )
        if (!freshAst) {
          return new Error('Current code could not be parsed.')
        }

        const newCode = renameParameterInComponentSource({
          ast: freshAst,
          code: commandProps.kclManager.code,
          componentName,
          parameterName: parameterName.name,
          newParameterName,
        })
        if (newCode instanceof Error) {
          return newCode
        }

        const parsed = await commandProps.kclManager.safeParse(
          newCode,
          commandProps.kclManager.wasmInstancePromise
        )
        if (!parsed) {
          return new Error('Failed to rename component parameter.')
        }

        commandProps.kclManager.updateCodeEditor(newCode, {
          shouldExecute: true,
          shouldWriteToDisk: true,
          shouldAddToHistory: true,
        })
      },
    },
    {
      name: 'component.deleteParameter',
      displayName: 'Delete component parameter',
      description: 'Inline a component parameter default and remove overrides.',
      icon: 'make-variable',
      groupId: 'code',
      needsReview: false,
      args: {
        componentName: {
          displayName: 'Component',
          inputType: 'options',
          required: true,
          options: () =>
            components.map((component) => ({
              name: component.name,
              value: component.name,
            })),
          validation: async ({ data }) => {
            if (typeof data !== 'string') {
              return 'Select a component.'
            }
            if (!components.some((component) => component.name === data)) {
              return `Could not find component ${data}.`
            }
            return true
          },
        },
        parameterName: {
          displayName: 'Parameter',
          inputType: 'options',
          required: true,
          valueSummary: (value: ComponentParameterOption) => value.name,
          options: (context) => {
            const componentName = context.argumentsToSubmit.componentName
            if (typeof componentName !== 'string') {
              return []
            }
            return componentParameterOptions(components, componentName)
          },
          validation: async ({ data }) => {
            if (!isComponentParameterOption(data)) {
              return 'Select a component parameter.'
            }
            return true
          },
        },
      },
      onSubmit: async (data) => {
        if (!data) {
          return new Error(NO_INPUT_PROVIDED_MESSAGE)
        }
        const { componentName, parameterName } = data
        if (
          typeof componentName !== 'string' ||
          !isComponentParameterOption(parameterName)
        ) {
          return new Error(NO_INPUT_PROVIDED_MESSAGE)
        }

        const freshAst = await commandProps.kclManager.safeParse(
          commandProps.kclManager.code,
          commandProps.kclManager.wasmInstancePromise
        )
        if (!freshAst) {
          return new Error('Current code could not be parsed.')
        }

        const newCode = deleteParameterFromComponentSource({
          ast: freshAst,
          code: commandProps.kclManager.code,
          componentName,
          parameterName: parameterName.name,
        })
        if (newCode instanceof Error) {
          return newCode
        }

        const parsed = await commandProps.kclManager.safeParse(
          newCode,
          commandProps.kclManager.wasmInstancePromise
        )
        if (!parsed) {
          return new Error('Failed to delete component parameter.')
        }

        commandProps.kclManager.updateCodeEditor(newCode, {
          shouldExecute: true,
          shouldWriteToDisk: true,
          shouldAddToHistory: true,
        })
      },
    },
    {
      name: 'format-code',
      displayName: 'Format Code',
      description: 'Nicely formats the KCL code in the editor.',
      needsReview: false,
      groupId: 'code',
      icon: 'code',
      onSubmit: () => {
        commandProps.kclManager.format().catch(reportRejection)
      },
    },
    {
      name: 'share-file-link',
      displayName: 'Share part via Zoo link',
      description: 'Create a link that contains a copy of the current file.',
      groupId: 'code',
      needsReview: false,
      icon: 'link',
      onSubmit: (input) => {
        copyFileShareLink({
          token: commandProps.authToken,
          code: commandProps.kclManager.code,
          name: commandProps.projectData.project?.name || '',
          isRestrictedToOrg: input?.event.data.isRestrictedToOrg ?? false,
          password: input?.event.data.password,
        }).catch(reportRejection)
      },
    },
    {
      name: 'parameter.create',
      displayName: 'Create parameter',
      description: 'Add a named constant to use in geometry',
      groupId: 'code',
      icon: 'make-variable',
      needsReview: false,
      args: {
        value: {
          inputType: 'kcl',
          required: true,
          createVariable: 'force',
          variableName: 'myParameter',
          defaultValue: '5',
        },
      },
      onSubmit: async (data) => {
        if (!data) {
          return new Error(NO_INPUT_PROVIDED_MESSAGE)
        }

        const { value } = data
        if (!('variableName' in value)) {
          return new Error('variable name is required')
        }
        if (
          !('insertIndex' in value) ||
          typeof value.insertIndex !== 'number'
        ) {
          return new Error('insert index is required')
        }
        if (!('valueText' in value) || typeof value.valueText !== 'string') {
          return new Error('value text is required')
        }
        if (!('variableDeclarationAst' in value)) {
          return new Error('variable declaration is required')
        }

        const freshAst = await commandProps.kclManager.safeParse(
          commandProps.kclManager.code,
          commandProps.kclManager.wasmInstancePromise
        )
        if (!freshAst) {
          return new Error('Current code could not be parsed')
        }

        const modifiedAst = structuredClone(freshAst)
        insertVariableAndOffsetPathToNode(value, modifiedAst)

        const newCode = recast(
          modifiedAst,
          await commandProps.kclManager.wasmInstancePromise
        )
        if (err(newCode)) {
          return new Error(`Failed to create parameter: ${newCode.message}`)
        }

        commandProps.kclManager.updateCodeEditor(newCode, {
          shouldExecute: true,
          shouldWriteToDisk: true,
          shouldAddToHistory: true,
        })
      },
    },
    {
      name: 'parameter.edit',
      displayName: 'Edit parameter',
      description: 'Edit the value of a named constant',
      groupId: 'code',
      icon: 'make-variable',
      needsReview: false,
      args: {
        nodeToEdit: {
          displayName: 'Name',
          inputType: 'options',
          valueSummary: (nodeToEdit: PathToNode) => {
            const node = getNodeFromPath<VariableDeclarator>(
              commandProps.kclManager.ast,
              nodeToEdit,
              commandProps.wasmInstance,
              'VariableDeclarator',
              true
            )
            if (err(node) || node.node.type !== 'VariableDeclarator')
              return 'Error'
            return node.node.id.name || ''
          },
          required: true,
          options() {
            return commandProps.kclManager.execState.operations.flatMap(
              (op) => {
                if (op.type !== 'VariableDeclaration') return []
                if (op.value.type !== 'Number') return []
                const value = pathToNodeFromRustNodePath(op.nodePath).slice(
                  0,
                  -1
                )
                return { name: op.name, value }
              }
            )
          },
        },
        value: {
          inputType: 'kcl',
          required: true,
          defaultValue(commandBarContext) {
            const nodeToEdit = commandBarContext.argumentsToSubmit.nodeToEdit
            if (!nodeToEdit || !isPathToNode(nodeToEdit)) return '5'
            const node = getNodeFromPath<VariableDeclarator>(
              commandProps.kclManager.ast,
              nodeToEdit,
              commandProps.wasmInstance,
              'VariableDeclarator'
            )
            if (err(node) || node.node.type !== 'VariableDeclarator')
              return 'Error'
            const variableName = node.node.id.name || ''
            if (typeof variableName !== 'string') return '5'
            const variableNode = getVariableDeclaration(
              commandProps.kclManager.ast,
              variableName
            )
            if (!variableNode) return '5'
            const code = commandProps.kclManager.code.slice(
              variableNode.declaration.init.start,
              variableNode.declaration.init.end
            )
            return code
          },
          createVariable: 'disallow',
        },
      },
      onSubmit: (data) => {
        if (!data) {
          return new Error(NO_INPUT_PROVIDED_MESSAGE)
        }

        // Get the variable AST node to edit
        const { nodeToEdit, value } = data
        const newAst = structuredClone(commandProps.kclManager.ast)
        const variableNode = getNodeFromPath<Node<VariableDeclarator>>(
          newAst,
          nodeToEdit,
          commandProps.wasmInstance
        )

        if (
          err(variableNode) ||
          variableNode.node.type !== 'VariableDeclarator' ||
          !variableNode.node
        ) {
          return new Error('No variable found, this is a bug')
        }

        // Mutate the variable's value
        variableNode.node.init = value.valueAst

        updateModelingState(
          newAst,
          EXECUTION_TYPE_REAL,
          commandProps.kclManager
        ).catch(reportRejection)
      },
    },
  ]
}
