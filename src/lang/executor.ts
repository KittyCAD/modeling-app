import {
  Program,
  BinaryPart,
  BinaryExpression,
  PipeExpression,
  ObjectExpression,
  MemberExpression,
  Identifier,
  CallExpression,
  ArrayExpression,
  UnaryExpression,
} from './abstractSyntaxTreeTypes'
import { InternalFnNames } from './std/stdTypes'
import { internalFns } from './std/std'
import {
  KCLUndefinedValueError,
  KCLValueAlreadyDefined,
  KCLSyntaxError,
  KCLSemanticError,
  KCLTypeError,
} from './errors'
import {
  EngineCommandManager,
  ArtifactMap,
  SourceRangeMap,
} from './std/engineConnection'

export type SourceRange = [number, number]
export type PathToNode = [string | number, string][] // [pathKey, nodeType][]
export type Metadata = {
  sourceRange: SourceRange
  pathToNode: PathToNode
}
export type Position = [number, number, number]
export type Rotation = [number, number, number, number]

interface BasePath {
  from: [number, number]
  to: [number, number]
  name?: string
  __geoMeta: {
    id: string
    sourceRange: SourceRange
    pathToNode: PathToNode
  }
}

export interface ToPoint extends BasePath {
  type: 'toPoint'
}

export interface Base extends BasePath {
  type: 'base'
}

export interface HorizontalLineTo extends BasePath {
  type: 'horizontalLineTo'
  x: number
}

export interface AngledLineTo extends BasePath {
  type: 'angledLineTo'
  angle: number
  x?: number
  y?: number
}

interface GeoMeta {
  __geoMeta: {
    id: string
    refId?: string
    sourceRange: SourceRange
    pathToNode: PathToNode
  }
}

export type Path = ToPoint | HorizontalLineTo | AngledLineTo | Base

export interface SketchGroup {
  type: 'sketchGroup'
  id: string
  value: Path[]
  start?: Base
  position: Position
  rotation: Rotation
  __meta: Metadata[]
}

interface ExtrudePlane {
  type: 'extrudePlane'
  position: Position
  rotation: Rotation
  name?: string
}

export type ExtrudeSurface = GeoMeta &
  ExtrudePlane /* | ExtrudeRadius | ExtrudeSpline */

export interface ExtrudeGroup {
  type: 'extrudeGroup'
  id: string
  value: ExtrudeSurface[]
  height: number
  position: Position
  rotation: Rotation
  __meta: Metadata[]
}

/** UserVal not produced by one of our internal functions */
export interface UserVal {
  type: 'userVal'
  value: any
  __meta: Metadata[]
}

type MemoryItem = UserVal | SketchGroup | ExtrudeGroup

interface Memory {
  [key: string]: MemoryItem
}
interface PendingMemory {
  [key: string]: Promise<MemoryItem>
}

export interface ProgramMemory {
  root: Memory
  pendingMemory: Partial<PendingMemory>
  return?: Identifier[]
}

const addItemToMemory = (
  programMemory: ProgramMemory,
  key: string,
  sourceRange: [[number, number]],
  value: MemoryItem | Promise<MemoryItem>
) => {
  const _programMemory = programMemory
  if (_programMemory.root[key] || _programMemory.pendingMemory[key]) {
    throw new KCLValueAlreadyDefined(key, sourceRange)
  }
  if (value instanceof Promise) {
    _programMemory.pendingMemory[key] = value
    value.then((resolvedValue) => {
      _programMemory.root[key] = resolvedValue
      delete _programMemory.pendingMemory[key]
    })
  } else {
    _programMemory.root[key] = value
  }
  return _programMemory
}

const promisifyMemoryItem = async (obj: MemoryItem) => {
  if (obj.value instanceof Promise) {
    const resolvedGuy = await obj.value
    return {
      ...obj,
      value: resolvedGuy,
    }
  }
  return obj
}

const getMemoryItem = async (
  programMemory: ProgramMemory,
  key: string,
  sourceRanges: [number, number][]
): Promise<MemoryItem> => {
  if (programMemory.root[key]) {
    return programMemory.root[key]
  }
  if (programMemory.pendingMemory[key]) {
    return programMemory.pendingMemory[key] as Promise<MemoryItem>
  }
  throw new KCLUndefinedValueError(`Memory item ${key} not found`, sourceRanges)
}

export const executor = async (
  node: Program,
  programMemory: ProgramMemory = { root: {}, pendingMemory: {} },
  engineCommandManager: EngineCommandManager,
  options: { bodyType: 'root' | 'sketch' | 'block' } = { bodyType: 'root' },
  previousPathToNode: PathToNode = [],
  // work around while the gemotry is still be stored on the frontend
  // will be removed when the stream UI is added.
  tempMapCallback: (a: {
    artifactMap: ArtifactMap
    sourceRangeMap: SourceRangeMap
  }) => void = () => {}
): Promise<ProgramMemory> => {
  engineCommandManager.startNewSession()
  const _programMemory = await _executor(
    node,
    programMemory,
    engineCommandManager,
    options,
    previousPathToNode
  )
  const { artifactMap, sourceRangeMap } =
    await engineCommandManager.waitForAllCommands()
  tempMapCallback({ artifactMap, sourceRangeMap })

  engineCommandManager.endSession()
  return _programMemory
}

export const _executor = async (
  node: Program,
  programMemory: ProgramMemory = { root: {}, pendingMemory: {} },
  engineCommandManager: EngineCommandManager,
  options: { bodyType: 'root' | 'sketch' | 'block' } = { bodyType: 'root' },
  previousPathToNode: PathToNode = []
): Promise<ProgramMemory> => {
  let _programMemory: ProgramMemory = {
    root: {
      ...programMemory.root,
    },
    pendingMemory: {
      ...programMemory.pendingMemory,
    },
    return: programMemory.return,
  }
  const { body } = node
  const proms: Promise<any>[] = []
  for (let bodyIndex = 0; bodyIndex < body.length; bodyIndex++) {
    const statement = body[bodyIndex]
    if (statement.type === 'VariableDeclaration') {
      for (let index = 0; index < statement.declarations.length; index++) {
        const declaration = statement.declarations[index]
        const variableName = declaration.id.name
        const pathToNode: PathToNode = [
          ...previousPathToNode,
          ['body', ''],
          [bodyIndex, 'index'],
          ['declarations', 'VariableDeclaration'],
          [index, 'index'],
          ['init', 'VariableDeclaration'],
        ]
        const sourceRange: SourceRange = [
          declaration.init.start,
          declaration.init.end,
        ]
        const __meta: Metadata[] = [
          {
            pathToNode,
            sourceRange,
          },
        ]

        if (declaration.init.type === 'PipeExpression') {
          const prom = getPipeExpressionResult(
            declaration.init,
            _programMemory,
            engineCommandManager,
            pathToNode
          )
          proms.push(prom)
          const value = await prom
          if (value?.type === 'sketchGroup' || value?.type === 'extrudeGroup') {
            _programMemory = addItemToMemory(
              _programMemory,
              variableName,
              [sourceRange],
              value
            )
          } else {
            _programMemory = addItemToMemory(
              _programMemory,
              variableName,
              [sourceRange],
              {
                type: 'userVal',
                value,
                __meta,
              }
            )
          }
        } else if (declaration.init.type === 'Identifier') {
          _programMemory = addItemToMemory(
            _programMemory,
            variableName,
            [sourceRange],
            {
              type: 'userVal',
              value: _programMemory.root[declaration.init.name].value,
              __meta,
            }
          )
        } else if (declaration.init.type === 'Literal') {
          _programMemory = addItemToMemory(
            _programMemory,
            variableName,
            [sourceRange],
            {
              type: 'userVal',
              value: declaration.init.value,
              __meta,
            }
          )
        } else if (declaration.init.type === 'BinaryExpression') {
          const prom = getBinaryExpressionResult(
            declaration.init,
            _programMemory,
            engineCommandManager
          )
          proms.push(prom)
          _programMemory = addItemToMemory(
            _programMemory,
            variableName,
            [sourceRange],
            promisifyMemoryItem({
              type: 'userVal',
              value: prom,
              __meta,
            })
          )
        } else if (declaration.init.type === 'UnaryExpression') {
          const prom = getUnaryExpressionResult(
            declaration.init,
            _programMemory,
            engineCommandManager
          )
          proms.push(prom)
          _programMemory = addItemToMemory(
            _programMemory,
            variableName,
            [sourceRange],
            promisifyMemoryItem({
              type: 'userVal',
              value: prom,
              __meta,
            })
          )
        } else if (declaration.init.type === 'ArrayExpression') {
          const valueInfo: Promise<{ value: any; __meta?: Metadata }>[] =
            declaration.init.elements.map(
              async (element): Promise<{ value: any; __meta?: Metadata }> => {
                if (element.type === 'Literal') {
                  return {
                    value: element.value,
                  }
                } else if (element.type === 'BinaryExpression') {
                  const prom = getBinaryExpressionResult(
                    element,
                    _programMemory,
                    engineCommandManager
                  )
                  proms.push(prom)
                  return {
                    value: await prom,
                  }
                } else if (element.type === 'PipeExpression') {
                  const prom = getPipeExpressionResult(
                    element,
                    _programMemory,
                    engineCommandManager,
                    pathToNode
                  )
                  proms.push(prom)
                  return {
                    value: await prom,
                  }
                } else if (element.type === 'Identifier') {
                  const node = await getMemoryItem(
                    _programMemory,
                    element.name,
                    [[element.start, element.end]]
                  )
                  return {
                    value: node.value,
                    __meta: node.__meta[node.__meta.length - 1],
                  }
                } else if (element.type === 'UnaryExpression') {
                  const prom = getUnaryExpressionResult(
                    element,
                    _programMemory,
                    engineCommandManager
                  )
                  proms.push(prom)
                  return {
                    value: await prom,
                  }
                } else {
                  throw new KCLSyntaxError(
                    `Unexpected element type ${element.type} in array expression`,
                    // TODO: Refactor this whole block into a `switch` so that we have a specific
                    // type here and can put a sourceRange.
                    []
                  )
                }
              }
            )
          const awaitedValueInfo = await Promise.all(valueInfo)
          const meta = awaitedValueInfo
            .filter(({ __meta }) => __meta)
            .map(({ __meta }) => __meta) as Metadata[]
          _programMemory = addItemToMemory(
            _programMemory,
            variableName,
            [sourceRange],
            {
              type: 'userVal',
              value: awaitedValueInfo.map(({ value }) => value),
              __meta: [...__meta, ...meta],
            }
          )
        } else if (declaration.init.type === 'ObjectExpression') {
          const prom = executeObjectExpression(
            _programMemory,
            declaration.init,
            engineCommandManager
          )
          proms.push(prom)
          _programMemory = addItemToMemory(
            _programMemory,
            variableName,
            [sourceRange],
            promisifyMemoryItem({
              type: 'userVal',
              value: prom,
              __meta,
            })
          )
        } else if (declaration.init.type === 'FunctionExpression') {
          const fnInit = declaration.init

          _programMemory = addItemToMemory(
            _programMemory,
            declaration.id.name,
            [sourceRange],
            {
              type: 'userVal',
              value: async (...args: any[]) => {
                let fnMemory: ProgramMemory = {
                  root: {
                    ..._programMemory.root,
                  },
                  pendingMemory: {
                    ..._programMemory.pendingMemory,
                  },
                }
                if (args.length > fnInit.params.length) {
                  throw new KCLSyntaxError(
                    `Too many arguments passed to function ${declaration.id.name}`,
                    [[declaration.start, declaration.end]]
                  )
                } else if (args.length < fnInit.params.length) {
                  throw new KCLSyntaxError(
                    `Too few arguments passed to function ${declaration.id.name}`,
                    [[declaration.start, declaration.end]]
                  )
                }
                fnInit.params.forEach((param, index) => {
                  fnMemory = addItemToMemory(
                    fnMemory,
                    param.name,
                    [sourceRange],
                    {
                      type: 'userVal',
                      value: args[index],
                      __meta,
                    }
                  )
                })
                const prom = _executor(
                  fnInit.body,
                  fnMemory,
                  engineCommandManager,
                  {
                    bodyType: 'block',
                  }
                )
                proms.push(prom)
                const result = (await prom).return
                return result
              },
              __meta,
            }
          )
        } else if (declaration.init.type === 'MemberExpression') {
          await Promise.all([...proms]) // TODO wait for previous promises, does that makes sense?
          const prom = getMemberExpressionResult(
            declaration.init,
            _programMemory
          )
          proms.push(prom)
          _programMemory = addItemToMemory(
            _programMemory,
            variableName,
            [sourceRange],
            promisifyMemoryItem({
              type: 'userVal',
              value: prom,
              __meta,
            })
          )
        } else if (declaration.init.type === 'CallExpression') {
          const prom = executeCallExpression(
            _programMemory,
            declaration.init,
            engineCommandManager,
            previousPathToNode
          )
          proms.push(prom)
          _programMemory = addItemToMemory(
            _programMemory,
            variableName,
            [sourceRange],
            prom.then((a) => {
              return a?.type === 'sketchGroup' || a?.type === 'extrudeGroup'
                ? a
                : {
                    type: 'userVal',
                    value: a,
                    __meta,
                  }
            })
          )
        } else {
          throw new KCLSyntaxError(
            'Unsupported declaration type: ' + declaration.init.type,
            [[declaration.start, declaration.end]]
          )
        }
      }
    } else if (statement.type === 'ExpressionStatement') {
      const expression = statement.expression
      if (expression.type === 'CallExpression') {
        const functionName = expression.callee.name
        const args = expression.arguments.map((arg) => {
          if (arg.type === 'Literal') {
            return arg.value
          } else if (arg.type === 'Identifier') {
            return _programMemory.root[arg.name]?.value
          }
        })
        if ('show' === functionName) {
          if (options.bodyType !== 'root') {
            throw new KCLSemanticError(
              `Cannot call ${functionName} outside of a root`,
              [[statement.start, statement.end]]
            )
          }
          _programMemory.return = expression.arguments as any // todo memory redo
        } else {
          if (_programMemory.root[functionName] == undefined) {
            throw new KCLSemanticError(`No such name ${functionName} defined`, [
              [statement.start, statement.end],
            ])
          }
          _programMemory.root[functionName].value(...args)
        }
      }
    } else if (statement.type === 'ReturnStatement') {
      if (statement.argument.type === 'BinaryExpression') {
        const prom = getBinaryExpressionResult(
          statement.argument,
          _programMemory,
          engineCommandManager
        )
        proms.push(prom)
        _programMemory.return = await prom
      }
    }
  }
  await Promise.all(proms)
  return _programMemory
}

function getMemberExpressionResult(
  expression: MemberExpression,
  programMemory: ProgramMemory
) {
  const propertyName = (
    expression.property.type === 'Identifier'
      ? expression.property.name
      : expression.property.value
  ) as any
  const object: any =
    expression.object.type === 'MemberExpression'
      ? getMemberExpressionResult(expression.object, programMemory)
      : programMemory.root[expression.object.name]?.value
  return object?.[propertyName]
}

async function getBinaryExpressionResult(
  expression: BinaryExpression,
  programMemory: ProgramMemory,
  engineCommandManager: EngineCommandManager,
  pipeInfo: {
    isInPipe: boolean
    previousResults: any[]
    expressionIndex: number
    body: PipeExpression['body']
    sourceRangeOverride?: SourceRange
  } = {
    isInPipe: false,
    previousResults: [],
    expressionIndex: 0,
    body: [],
  }
) {
  const _pipeInfo = {
    ...pipeInfo,
    isInPipe: false,
  }
  const left = await getBinaryPartResult(
    expression.left,
    programMemory,
    engineCommandManager,
    _pipeInfo
  )
  const right = await getBinaryPartResult(
    expression.right,
    programMemory,
    engineCommandManager,
    _pipeInfo
  )
  if (expression.operator === '+') return left + right
  if (expression.operator === '-') return left - right
  if (expression.operator === '*') return left * right
  if (expression.operator === '/') return left / right
  if (expression.operator === '%') return left % right
}

async function getBinaryPartResult(
  part: BinaryPart,
  programMemory: ProgramMemory,
  engineCommandManager: EngineCommandManager,
  pipeInfo: {
    isInPipe: boolean
    previousResults: any[]
    expressionIndex: number
    body: PipeExpression['body']
    sourceRangeOverride?: SourceRange
  } = {
    isInPipe: false,
    previousResults: [],
    expressionIndex: 0,
    body: [],
  }
): Promise<any> {
  const _pipeInfo = {
    ...pipeInfo,
    isInPipe: false,
  }
  if (part.type === 'Literal') {
    return part.value
  } else if (part.type === 'Identifier') {
    return programMemory.root[part.name].value
  } else if (part.type === 'BinaryExpression') {
    const prom = getBinaryExpressionResult(
      part,
      programMemory,
      engineCommandManager,
      _pipeInfo
    )
    const result = await prom
    return result
  } else if (part.type === 'CallExpression') {
    const result = await executeCallExpression(
      programMemory,
      part,
      engineCommandManager,
      [],
      _pipeInfo
    )
    return result
  }
}

async function getUnaryExpressionResult(
  expression: UnaryExpression,
  programMemory: ProgramMemory,
  engineCommandManager: EngineCommandManager,
  pipeInfo: {
    isInPipe: boolean
    previousResults: any[]
    expressionIndex: number
    body: PipeExpression['body']
    sourceRangeOverride?: SourceRange
  } = {
    isInPipe: false,
    previousResults: [],
    expressionIndex: 0,
    body: [],
  }
) {
  return -(await getBinaryPartResult(
    expression.argument,
    programMemory,
    engineCommandManager,
    {
      ...pipeInfo,
      isInPipe: false,
    }
  ))
}

async function getPipeExpressionResult(
  expression: PipeExpression,
  programMemory: ProgramMemory,
  engineCommandManager: EngineCommandManager,
  previousPathToNode: PathToNode = []
) {
  const executedBody = await executePipeBody(
    expression.body,
    programMemory,
    engineCommandManager,
    previousPathToNode
  )
  const result = executedBody[executedBody.length - 1]
  return result
}

async function executePipeBody(
  body: PipeExpression['body'],
  programMemory: ProgramMemory,
  engineCommandManager: EngineCommandManager,
  previousPathToNode: PathToNode = [],
  expressionIndex = 0,
  previousResults: any[] = []
): Promise<any[]> {
  if (expressionIndex === body.length) {
    return previousResults
  }
  const expression = body[expressionIndex]
  if (expression.type === 'BinaryExpression') {
    const result = await getBinaryExpressionResult(
      expression,
      programMemory,
      engineCommandManager
    )
    return executePipeBody(
      body,
      programMemory,
      engineCommandManager,
      previousPathToNode,
      expressionIndex + 1,
      [...previousResults, result]
    )
  } else if (expression.type === 'CallExpression') {
    return await executeCallExpression(
      programMemory,
      expression,
      engineCommandManager,
      previousPathToNode,
      {
        isInPipe: true,
        previousResults,
        expressionIndex,
        body,
      }
    )
  }

  throw new KCLSyntaxError('Invalid pipe expression', [
    [expression.start, expression.end],
  ])
}

async function executeObjectExpression(
  _programMemory: ProgramMemory,
  objExp: ObjectExpression,
  engineCommandManager: EngineCommandManager,
  pipeInfo: {
    isInPipe: boolean
    previousResults: any[]
    expressionIndex: number
    body: PipeExpression['body']
    sourceRangeOverride?: SourceRange
  } = {
    isInPipe: false,
    previousResults: [],
    expressionIndex: 0,
    body: [],
  }
) {
  const _pipeInfo = {
    ...pipeInfo,
    isInPipe: false,
  }
  const obj: { [key: string]: any } = {}
  const proms: Promise<any>[] = []
  objExp.properties.forEach(async (property) => {
    if (property.type === 'ObjectProperty') {
      if (property.value.type === 'Literal') {
        obj[property.key.name] = property.value.value
      } else if (property.value.type === 'BinaryExpression') {
        const prom = getBinaryExpressionResult(
          property.value,
          _programMemory,
          engineCommandManager,
          _pipeInfo
        )
        proms.push(prom)
        obj[property.key.name] = await prom
      } else if (property.value.type === 'PipeExpression') {
        const prom = getPipeExpressionResult(
          property.value,
          _programMemory,
          engineCommandManager
        )
        proms.push(prom)
        obj[property.key.name] = await prom
      } else if (property.value.type === 'Identifier') {
        obj[property.key.name] = (
          await getMemoryItem(_programMemory, property.value.name, [
            [property.value.start, property.value.end],
          ])
        ).value
      } else if (property.value.type === 'ObjectExpression') {
        const prom = executeObjectExpression(
          _programMemory,
          property.value,
          engineCommandManager
        )
        proms.push(prom)
        obj[property.key.name] = await prom
      } else if (property.value.type === 'ArrayExpression') {
        const prom = executeArrayExpression(
          _programMemory,
          property.value,
          engineCommandManager
        )
        proms.push(prom)
        obj[property.key.name] = await prom
      } else if (property.value.type === 'CallExpression') {
        const prom = executeCallExpression(
          _programMemory,
          property.value,
          engineCommandManager,
          [],
          _pipeInfo
        )
        proms.push(prom)
        const result = await prom
        obj[property.key.name] = result
      } else if (property.value.type === 'UnaryExpression') {
        const prom = getUnaryExpressionResult(
          property.value,
          _programMemory,
          engineCommandManager
        )
        proms.push(prom)
        obj[property.key.name] = await prom
      } else {
        throw new KCLSyntaxError(
          `Unexpected property type ${property.value.type} in object expression`,
          [[property.value.start, property.value.end]]
        )
      }
    } else {
      throw new KCLSyntaxError(
        `Unexpected property type ${property.type} in object expression`,
        [[property.value.start, property.value.end]]
      )
    }
  })
  await Promise.all(proms)
  return obj
}

async function executeArrayExpression(
  _programMemory: ProgramMemory,
  arrExp: ArrayExpression,
  engineCommandManager: EngineCommandManager,
  pipeInfo: {
    isInPipe: boolean
    previousResults: any[]
    expressionIndex: number
    body: PipeExpression['body']
    sourceRangeOverride?: SourceRange
  } = {
    isInPipe: false,
    previousResults: [],
    expressionIndex: 0,
    body: [],
  }
) {
  const _pipeInfo = {
    ...pipeInfo,
    isInPipe: false,
  }
  return await Promise.all(
    arrExp.elements.map((el) => {
      if (el.type === 'Literal') {
        return el.value
      } else if (el.type === 'Identifier') {
        return _programMemory.root?.[el.name]?.value
      } else if (el.type === 'BinaryExpression') {
        return getBinaryExpressionResult(
          el,
          _programMemory,
          engineCommandManager,
          _pipeInfo
        )
      } else if (el.type === 'ObjectExpression') {
        return executeObjectExpression(_programMemory, el, engineCommandManager)
      } else if (el.type === 'CallExpression') {
        const result: any = executeCallExpression(
          _programMemory,
          el,
          engineCommandManager,
          [],
          _pipeInfo
        )
        return result
      } else if (el.type === 'UnaryExpression') {
        return getUnaryExpressionResult(
          el,
          _programMemory,
          engineCommandManager,
          {
            ...pipeInfo,
            isInPipe: false,
          }
        )
      }
      throw new KCLTypeError('Invalid argument type', [[el.start, el.end]])
    })
  )
}

async function executeCallExpression(
  programMemory: ProgramMemory,
  expression: CallExpression,
  engineCommandManager: EngineCommandManager,
  previousPathToNode: PathToNode = [],
  pipeInfo: {
    isInPipe: boolean
    previousResults: any[]
    expressionIndex: number
    body: PipeExpression['body']
    sourceRangeOverride?: SourceRange
  } = {
    isInPipe: false,
    previousResults: [],
    expressionIndex: 0,
    body: [],
  }
) {
  const {
    isInPipe,
    previousResults,
    expressionIndex,
    body,
    sourceRangeOverride,
  } = pipeInfo
  const functionName = expression?.callee?.name
  const _pipeInfo = {
    ...pipeInfo,
    isInPipe: false,
  }
  const fnArgs = await Promise.all(
    expression?.arguments?.map(async (arg) => {
      if (arg.type === 'Literal') {
        return arg.value
      } else if (arg.type === 'Identifier') {
        await new Promise((r) => setTimeout(r)) // push into next even loop, but also probably should fix this
        const temp = await getMemoryItem(programMemory, arg.name, [
          [arg.start, arg.end],
        ])
        return temp?.type === 'userVal' ? temp.value : temp
      } else if (arg.type === 'PipeSubstitution') {
        return previousResults[expressionIndex - 1]
      } else if (arg.type === 'ArrayExpression') {
        return await executeArrayExpression(
          programMemory,
          arg,
          engineCommandManager,
          pipeInfo
        )
      } else if (arg.type === 'CallExpression') {
        const result: any = await executeCallExpression(
          programMemory,
          arg,
          engineCommandManager,
          previousPathToNode,
          _pipeInfo
        )
        return result
      } else if (arg.type === 'ObjectExpression') {
        return await executeObjectExpression(
          programMemory,
          arg,
          engineCommandManager,
          _pipeInfo
        )
      } else if (arg.type === 'UnaryExpression') {
        return getUnaryExpressionResult(
          arg,
          programMemory,
          engineCommandManager,
          _pipeInfo
        )
      } else if (arg.type === 'BinaryExpression') {
        return getBinaryExpressionResult(
          arg,
          programMemory,
          engineCommandManager,
          _pipeInfo
        )
      }
      throw new KCLSyntaxError('Invalid argument type in function call', [
        [arg.start, arg.end],
      ])
    })
  )
  if (functionName in internalFns) {
    const fnNameWithSketchOrExtrude = functionName as InternalFnNames
    const result = await internalFns[fnNameWithSketchOrExtrude](
      {
        programMemory,
        sourceRange: sourceRangeOverride || [expression.start, expression.end],
        engineCommandManager,
        code: JSON.stringify(expression),
      },
      fnArgs[0],
      fnArgs[1],
      fnArgs[2]
    )
    return isInPipe
      ? await executePipeBody(
          body,
          programMemory,
          engineCommandManager,
          previousPathToNode,
          expressionIndex + 1,
          [...previousResults, result]
        )
      : result
  }
  const result = await programMemory.root[functionName].value(...fnArgs)
  return isInPipe
    ? await executePipeBody(
        body,
        programMemory,
        engineCommandManager,
        previousPathToNode,
        expressionIndex + 1,
        [...previousResults, result]
      )
    : result
}
