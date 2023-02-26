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

export type SourceRange = [number, number]
export type PathToNode = (string | number)[]
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
    geos: {
      geo: BufferGeometry
      type: 'line' | 'lineEnd'
    }[]
    sourceRange: SourceRange
    pathToNode: PathToNode
  }
}

export interface ToPoint extends BasePath {
  type: 'toPoint'
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
    sourceRange: SourceRange
    pathToNode: PathToNode
  }
}

export type Path = ToPoint | HorizontalLineTo | AngledLineTo

export interface SketchGroup {
  type: 'sketchGroup'
  value: Path[]
  start?: Path['from']
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

export const executor = (
  node: Program,
  programMemory: ProgramMemory = { root: {}, _sketch: [] },
  options: { bodyType: 'root' | 'sketch' | 'block' } = { bodyType: 'root' },
  previousPathToNode: PathToNode = []
): ProgramMemory => {
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
        const pathToNode = [
          ...previousPathToNode,
          'body',
          bodyIndex,
          'declarations',
          index,
          'init',
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
        } else if (declaration.init.type === 'Literal') {
          _programMemory.root[variableName] = {
            type: 'userVal',
            value: declaration.init.value,
            __meta,
          }
        } else if (declaration.init.type === 'BinaryExpression') {
          _programMemory.root[variableName] = {
            type: 'userVal',
            value: getBinaryExpressionResult(declaration.init, _programMemory),
            __meta,
          }
        } else if (declaration.init.type === 'UnaryExpression') {
          _programMemory.root[variableName] = {
            type: 'userVal',
            value: getUnaryExpressionResult(declaration.init, _programMemory),
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
                    value: getBinaryExpressionResult(element, _programMemory),
                  }
                } else if (element.type === 'PipeExpression') {
                  return {
                    value: getPipeExpressionResult(
                      element,
                      _programMemory,
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
                    value: getUnaryExpressionResult(element, _programMemory),
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
            value: executeObjectExpression(_programMemory, declaration.init),
            __meta,
          }
        } else if (declaration.init.type === 'FunctionExpression') {
          const fnInit = declaration.init

          _programMemory.root[declaration.id.name] = {
            type: 'userVal',
            value: (...args: any[]) => {
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
              return executor(fnInit.body, fnMemory, { bodyType: 'block' })
                .return
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
          _programMemory
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
  programMemory: ProgramMemory
) {
  const left = getBinaryPartResult(expression.left, programMemory)
  const right = getBinaryPartResult(expression.right, programMemory)
  if (expression.operator === '+') return left + right
  if (expression.operator === '-') return left - right
  if (expression.operator === '*') return left * right
  if (expression.operator === '/') return left / right
  if (expression.operator === '%') return left % right
}

function getBinaryPartResult(
  part: BinaryPart,
  programMemory: ProgramMemory
): any {
  if (part.type === 'Literal') {
    return part.value
  } else if (part.type === 'Identifier') {
    return programMemory.root[part.name].value
  } else if (part.type === 'BinaryExpression') {
    return getBinaryExpressionResult(part, programMemory)
  } else if (part.type === 'CallExpression') {
    return executeCallExpression(programMemory, part)
  }
}

function getUnaryExpressionResult(
  expression: UnaryExpression,
  programMemory: ProgramMemory
) {
  return -getBinaryPartResult(expression.argument, programMemory)
}

function getPipeExpressionResult(
  expression: PipeExpression,
  programMemory: ProgramMemory,
  previousPathToNode: PathToNode = []
) {
  const executedBody = executePipeBody(
    expression.body,
    programMemory,
    previousPathToNode
  )
  const result = executedBody[executedBody.length - 1]
  return result
}

function executePipeBody(
  body: PipeExpression['body'],
  programMemory: ProgramMemory,
  previousPathToNode: PathToNode = [],
  expressionIndex = 0,
  previousResults: any[] = []
): any[] {
  if (expressionIndex === body.length) {
    return previousResults
  }
  const expression = body[expressionIndex]
  if (expression.type === 'BinaryExpression') {
    const result = getBinaryExpressionResult(expression, programMemory)
    return executePipeBody(
      body,
      programMemory,
      previousPathToNode,
      expressionIndex + 1,
      [...previousResults, result]
    )
  } else if (expression.type === 'CallExpression') {
    return executeCallExpression(
      programMemory,
      expression,
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
  objExp: ObjectExpression
) {
  const obj: { [key: string]: any } = {}
  objExp.properties.forEach((property) => {
    if (property.type === 'ObjectProperty') {
      if (property.value.type === 'Literal') {
        obj[property.key.name] = property.value.value
      } else if (property.value.type === 'BinaryExpression') {
        obj[property.key.name] = getBinaryExpressionResult(
          property.value,
          _programMemory
        )
      } else if (property.value.type === 'PipeExpression') {
        obj[property.key.name] = getPipeExpressionResult(
          property.value,
          _programMemory
        )
      } else if (property.value.type === 'Identifier') {
        obj[property.key.name] = _programMemory.root[property.value.name].value
      } else if (property.value.type === 'ObjectExpression') {
        obj[property.key.name] = executeObjectExpression(
          _programMemory,
          property.value
        )
      } else if (property.value.type === 'ArrayExpression') {
        const result = executeArrayExpression(_programMemory, property.value)
        obj[property.key.name] = result
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
  return arrExp.elements.map((el) => {
    if (el.type === 'Literal') {
      return el.value
    } else if (el.type === 'Identifier') {
      return _programMemory.root?.[el.name]?.value
    } else if (el.type === 'BinaryExpression') {
      return getBinaryExpressionResult(el, _programMemory)
    } else if (el.type === 'ObjectExpression') {
      return executeObjectExpression(_programMemory, el)
    } else if (el.type === 'CallExpression') {
      const result: any = executeCallExpression(_programMemory, el, [], {
        ...pipeInfo,
        isInPipe: false,
      })
      return result
    } else if (el.type === 'UnaryExpression') {
      return getUnaryExpressionResult(el, _programMemory)
    }
    throw new Error('Invalid argument type')
  })
}

function executeCallExpression(
  programMemory: ProgramMemory,
  expression: CallExpression,
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
  const fnArgs = expression?.arguments?.map((arg) => {
    if (arg.type === 'Literal') {
      return arg.value
    } else if (arg.type === 'Identifier') {
      const temp = programMemory.root[arg.name]
      return temp?.type === 'userVal' ? temp.value : temp
    } else if (arg.type === 'PipeSubstitution') {
      return previousResults[expressionIndex - 1]
    } else if (arg.type === 'ArrayExpression') {
      return executeArrayExpression(programMemory, arg, pipeInfo)
    } else if (arg.type === 'CallExpression') {
      const result: any = executeCallExpression(
        programMemory,
        arg,
        previousPathToNode,
        pipeInfo
      )
      return result
    } else if (arg.type === 'ObjectExpression') {
      return executeObjectExpression(programMemory, arg)
    } else if (arg.type === 'UnaryExpression') {
      return getUnaryExpressionResult(arg, programMemory)
    }
    throw new Error('Invalid argument type in function call')
  })
  if (functionName in internalFns) {
    const fnNameWithSketchOrExtrude = functionName as InternalFnNames
    const result = internalFns[fnNameWithSketchOrExtrude](
      {
        programMemory,
        sourceRange: sourceRangeOverride || [expression.start, expression.end],
      },
      fnArgs[0],
      fnArgs[1]
    )
    return isInPipe
      ? executePipeBody(
          body,
          programMemory,
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
        previousPathToNode,
        expressionIndex + 1,
        [...previousResults, result]
      )
    : result
}
