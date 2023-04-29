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
} from './abstractSyntaxTree'
import { InternalFnNames } from './std/stdTypes'
import { internalFns } from './std/std'
import { BufferGeometry } from 'three'
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
    geos: {
      geo: BufferGeometry
      type: 'line' | 'lineEnd' | 'sketchBase'
    }[]
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
    geo: BufferGeometry
    id: string
    sourceRange: SourceRange
    pathToNode: PathToNode
  }
}

export type Path = ToPoint | HorizontalLineTo | AngledLineTo | Base

export interface SketchGroup {
  type: 'sketchGroup'
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

interface Memory {
  [key: string]: UserVal | SketchGroup | ExtrudeGroup // | Memory
}

export interface ProgramMemory {
  root: Memory
  return?: Identifier[]
  _sketch?: Path[]
}

export const executor = async (
  node: Program,
  programMemory: ProgramMemory = { root: {}, _sketch: [] },
  options: { bodyType: 'root' | 'sketch' | 'block' } = { bodyType: 'root' },
  previousPathToNode: PathToNode = [],
  // work around while the gemotry is still be stored on the frontend
  // will be removed when the stream UI is added.
  tempMapCallback: (a: {
    artifactMap: ArtifactMap
    sourceRangeMap: SourceRangeMap
  }) => void = () => {}
): Promise<ProgramMemory> => {
  const engineCommandManager = new EngineCommandManager()
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
  programMemory: ProgramMemory = { root: {}, _sketch: [] },
  engineCommandManager: EngineCommandManager,
  options: { bodyType: 'root' | 'sketch' | 'block' } = { bodyType: 'root' },
  previousPathToNode: PathToNode = []
): Promise<ProgramMemory> => {
  const _programMemory: ProgramMemory = {
    root: {
      ...programMemory.root,
    },
    _sketch: [],
    return: programMemory.return,
  }
  const { body } = node
  body.forEach((statement, bodyIndex) => {
    if (statement.type === 'VariableDeclaration') {
      statement.declarations.forEach((declaration, index) => {
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
          const value = getPipeExpressionResult(
            declaration.init,
            _programMemory,
            engineCommandManager,
            pathToNode
          )
          if (value?.type === 'sketchGroup' || value?.type === 'extrudeGroup') {
            _programMemory.root[variableName] = value
          } else {
            _programMemory.root[variableName] = {
              type: 'userVal',
              value,
              __meta,
            }
          }
        } else if (declaration.init.type === 'Identifier') {
          _programMemory.root[variableName] = {
            type: 'userVal',
            value: _programMemory.root[declaration.init.name].value,
            __meta,
          }
        } else if (declaration.init.type === 'Literal') {
          _programMemory.root[variableName] = {
            type: 'userVal',
            value: declaration.init.value,
            __meta,
          }
        } else if (declaration.init.type === 'BinaryExpression') {
          _programMemory.root[variableName] = {
            type: 'userVal',
            value: getBinaryExpressionResult(
              declaration.init,
              _programMemory,
              engineCommandManager
            ),
            __meta,
          }
        } else if (declaration.init.type === 'UnaryExpression') {
          _programMemory.root[variableName] = {
            type: 'userVal',
            value: getUnaryExpressionResult(
              declaration.init,
              _programMemory,
              engineCommandManager
            ),
            __meta,
          }
        } else if (declaration.init.type === 'ArrayExpression') {
          const valueInfo: { value: any; __meta?: Metadata }[] =
            declaration.init.elements.map(
              (element): { value: any; __meta?: Metadata } => {
                if (element.type === 'Literal') {
                  return {
                    value: element.value,
                  }
                } else if (element.type === 'BinaryExpression') {
                  return {
                    value: getBinaryExpressionResult(
                      element,
                      _programMemory,
                      engineCommandManager
                    ),
                  }
                } else if (element.type === 'PipeExpression') {
                  return {
                    value: getPipeExpressionResult(
                      element,
                      _programMemory,
                      engineCommandManager,
                      pathToNode
                    ),
                  }
                } else if (element.type === 'Identifier') {
                  const node = _programMemory.root[element.name]
                  return {
                    value: node.value,
                    __meta: node.__meta[node.__meta.length - 1],
                  }
                } else if (element.type === 'UnaryExpression') {
                  return {
                    value: getUnaryExpressionResult(
                      element,
                      _programMemory,
                      engineCommandManager
                    ),
                  }
                } else {
                  throw new Error(
                    `Unexpected element type ${element.type} in array expression`
                  )
                }
              }
            )
          const meta = valueInfo
            .filter(({ __meta }) => __meta)
            .map(({ __meta }) => __meta) as Metadata[]
          _programMemory.root[variableName] = {
            type: 'userVal',
            value: valueInfo.map(({ value }) => value),
            __meta: [...__meta, ...meta],
          }
        } else if (declaration.init.type === 'ObjectExpression') {
          _programMemory.root[variableName] = {
            type: 'userVal',
            value: executeObjectExpression(
              _programMemory,
              declaration.init,
              engineCommandManager
            ),
            __meta,
          }
        } else if (declaration.init.type === 'FunctionExpression') {
          const fnInit = declaration.init

          _programMemory.root[declaration.id.name] = {
            type: 'userVal',
            value: async (...args: any[]) => {
              const fnMemory: ProgramMemory = {
                root: {
                  ..._programMemory.root,
                },
                _sketch: [],
              }
              if (args.length > fnInit.params.length) {
                throw new Error(
                  `Too many arguments passed to function ${declaration.id.name}`
                )
              } else if (args.length < fnInit.params.length) {
                throw new Error(
                  `Too few arguments passed to function ${declaration.id.name}`
                )
              }
              fnInit.params.forEach((param, index) => {
                fnMemory.root[param.name] = {
                  type: 'userVal',
                  value: args[index],
                  __meta,
                }
              })
              return (
                await _executor(fnInit.body, fnMemory, engineCommandManager, {
                  bodyType: 'block',
                })
              ).return
            },
            __meta,
          }
        } else if (declaration.init.type === 'MemberExpression') {
          _programMemory.root[variableName] = {
            type: 'userVal',
            value: getMemberExpressionResult(declaration.init, _programMemory),
            __meta,
          }
        } else if (declaration.init.type === 'CallExpression') {
          const result = executeCallExpression(
            _programMemory,
            declaration.init,
            engineCommandManager,
            previousPathToNode
          )
          _programMemory.root[variableName] =
            result?.type === 'sketchGroup' || result?.type === 'extrudeGroup'
              ? result
              : {
                  type: 'userVal',
                  value: result,
                  __meta,
                }
        } else {
          throw new Error(
            'Unsupported declaration type: ' + declaration.init.type
          )
        }
      })
    } else if (statement.type === 'ExpressionStatement') {
      const expression = statement.expression
      if (expression.type === 'CallExpression') {
        const functionName = expression.callee.name
        const args = expression.arguments.map((arg) => {
          if (arg.type === 'Literal') {
            return arg.value
          } else if (arg.type === 'Identifier') {
            return _programMemory.root[arg.name].value
          }
        })
        if ('show' === functionName) {
          if (options.bodyType !== 'root') {
            throw new Error(`Cannot call ${functionName} outside of a root`)
          }
          _programMemory.return = expression.arguments as any // todo memory redo
        } else {
          _programMemory.root[functionName].value(...args)
        }
      }
    } else if (statement.type === 'ReturnStatement') {
      if (statement.argument.type === 'BinaryExpression') {
        _programMemory.return = getBinaryExpressionResult(
          statement.argument,
          _programMemory,
          engineCommandManager
        )
      }
    }
  })
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
      : programMemory.root[expression.object.name].value
  return object[propertyName]
}

function getBinaryExpressionResult(
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
  const left = getBinaryPartResult(
    expression.left,
    programMemory,
    engineCommandManager,
    _pipeInfo
  )
  const right = getBinaryPartResult(
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

function getBinaryPartResult(
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
): any {
  const _pipeInfo = {
    ...pipeInfo,
    isInPipe: false,
  }
  if (part.type === 'Literal') {
    return part.value
  } else if (part.type === 'Identifier') {
    return programMemory.root[part.name].value
  } else if (part.type === 'BinaryExpression') {
    return getBinaryExpressionResult(
      part,
      programMemory,
      engineCommandManager,
      _pipeInfo
    )
  } else if (part.type === 'CallExpression') {
    return executeCallExpression(
      programMemory,
      part,
      engineCommandManager,
      [],
      _pipeInfo
    )
  }
}

function getUnaryExpressionResult(
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
  return -getBinaryPartResult(
    expression.argument,
    programMemory,
    engineCommandManager,
    {
      ...pipeInfo,
      isInPipe: false,
    }
  )
}

function getPipeExpressionResult(
  expression: PipeExpression,
  programMemory: ProgramMemory,
  engineCommandManager: EngineCommandManager,
  previousPathToNode: PathToNode = []
) {
  const executedBody = executePipeBody(
    expression.body,
    programMemory,
    engineCommandManager,
    previousPathToNode
  )
  const result = executedBody[executedBody.length - 1]
  return result
}

function executePipeBody(
  body: PipeExpression['body'],
  programMemory: ProgramMemory,
  engineCommandManager: EngineCommandManager,
  previousPathToNode: PathToNode = [],
  expressionIndex = 0,
  previousResults: any[] = []
): any[] {
  if (expressionIndex === body.length) {
    return previousResults
  }
  const expression = body[expressionIndex]
  if (expression.type === 'BinaryExpression') {
    const result = getBinaryExpressionResult(
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
    return executeCallExpression(
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

  throw new Error('Invalid pipe expression')
}

function executeObjectExpression(
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
  objExp.properties.forEach((property) => {
    if (property.type === 'ObjectProperty') {
      if (property.value.type === 'Literal') {
        obj[property.key.name] = property.value.value
      } else if (property.value.type === 'BinaryExpression') {
        obj[property.key.name] = getBinaryExpressionResult(
          property.value,
          _programMemory,
          engineCommandManager,
          _pipeInfo
        )
      } else if (property.value.type === 'PipeExpression') {
        obj[property.key.name] = getPipeExpressionResult(
          property.value,
          _programMemory,
          engineCommandManager
        )
      } else if (property.value.type === 'Identifier') {
        obj[property.key.name] = _programMemory.root[property.value.name].value
      } else if (property.value.type === 'ObjectExpression') {
        obj[property.key.name] = executeObjectExpression(
          _programMemory,
          property.value,
          engineCommandManager
        )
      } else if (property.value.type === 'ArrayExpression') {
        const result = executeArrayExpression(
          _programMemory,
          property.value,
          engineCommandManager
        )
        obj[property.key.name] = result
      } else if (property.value.type === 'CallExpression') {
        obj[property.key.name] = executeCallExpression(
          _programMemory,
          property.value,
          engineCommandManager,
          [],
          _pipeInfo
        )
      } else if (property.value.type === 'UnaryExpression') {
        obj[property.key.name] = getUnaryExpressionResult(
          property.value,
          _programMemory,
          engineCommandManager
        )
      } else {
        throw new Error(
          `Unexpected property type ${property.value.type} in object expression`
        )
      }
    } else {
      throw new Error(
        `Unexpected property type ${property.type} in object expression`
      )
    }
  })
  return obj
}

function executeArrayExpression(
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
  return arrExp.elements.map((el) => {
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
    throw new Error('Invalid argument type')
  })
}

function executeCallExpression(
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
  const fnArgs = expression?.arguments?.map((arg) => {
    if (arg.type === 'Literal') {
      return arg.value
    } else if (arg.type === 'Identifier') {
      const temp = programMemory.root[arg.name]
      return temp?.type === 'userVal' ? temp.value : temp
    } else if (arg.type === 'PipeSubstitution') {
      return previousResults[expressionIndex - 1]
    } else if (arg.type === 'ArrayExpression') {
      return executeArrayExpression(
        programMemory,
        arg,
        engineCommandManager,
        pipeInfo
      )
    } else if (arg.type === 'CallExpression') {
      const result: any = executeCallExpression(
        programMemory,
        arg,
        engineCommandManager,
        previousPathToNode,
        _pipeInfo
      )
      return result
    } else if (arg.type === 'ObjectExpression') {
      return executeObjectExpression(
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
    throw new Error('Invalid argument type in function call')
  })
  if (functionName in internalFns) {
    const fnNameWithSketchOrExtrude = functionName as InternalFnNames
    const result = internalFns[fnNameWithSketchOrExtrude](
      {
        programMemory,
        sourceRange: sourceRangeOverride || [expression.start, expression.end],
        engineCommandManager,
      },
      fnArgs[0],
      fnArgs[1],
      fnArgs[2]
    )
    return isInPipe
      ? executePipeBody(
          body,
          programMemory,
          engineCommandManager,
          previousPathToNode,
          expressionIndex + 1,
          [...previousResults, result]
        )
      : result
  }
  const result = programMemory.root[functionName].value(...fnArgs)
  return isInPipe
    ? executePipeBody(
        body,
        programMemory,
        engineCommandManager,
        previousPathToNode,
        expressionIndex + 1,
        [...previousResults, result]
      )
    : result
}
