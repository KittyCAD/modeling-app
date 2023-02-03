import {
  Program,
  BinaryPart,
  BinaryExpression,
  PipeExpression,
  ObjectExpression,
  MemberExpression,
  Identifier,
  CallExpression,
} from './abstractSyntaxTree'
import {
  sketchFns,
  internalFns,
  InternalFnNames,
  SketchFnNames,
} from './sketch'
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
        } else if (declaration.init.type === 'SketchExpression') {
          const sketchInit = declaration.init
          const fnMemory: ProgramMemory = {
            root: {
              ..._programMemory.root,
            },
            _sketch: [],
          }
          let { _sketch } = executor(sketchInit.body, fnMemory, {
            bodyType: 'sketch',
          })
          const newSketch: SketchGroup = {
            type: 'sketchGroup',
            value: _sketch || [],
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1], //x,y,z,w
            __meta,
          }
          _programMemory.root[variableName] = newSketch
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
          const functionName = declaration.init.callee.name
          const fnArgs = declaration.init.arguments.map((arg) => {
            if (arg.type === 'Literal') {
              return arg.value
            } else if (arg.type === 'Identifier') {
              return _programMemory.root[arg.name].value
            } else if (arg.type === 'ObjectExpression') {
              return executeObjectExpression(_programMemory, arg)
            }
            throw new Error(
              `Unexpected argument type ${arg.type} in function call`
            )
          })
          if (functionName in sketchFns) {
            const sketchFnName = functionName as SketchFnNames
            if (options.bodyType !== 'sketch') {
              throw new Error(
                `Cannot call ${functionName} outside of a sketch declaration`
              )
            }
            const result = sketchFns[sketchFnName](
              {
                programMemory: _programMemory,
                name: variableName,
                sourceRange: [declaration.start, declaration.end],
              },
              ...fnArgs
            )
            _programMemory._sketch = result.programMemory._sketch
            _programMemory.root[variableName] = {
              type: 'userVal',
              value: result.currentPath,
              __meta,
            }
          } else if (functionName in internalFns) {
            const result = executeCallExpression(
              _programMemory,
              declaration.init,
              previousPathToNode,
              {
                sourceRangeOverride: [declaration.start, declaration.end],
                isInPipe: false,
                previousResults: [],
                expressionIndex: 0,
                body: [],
              }
            )
            if (
              result.type === 'extrudeGroup' ||
              result.type === 'extrudePath'
            ) {
              _programMemory.root[variableName] = result
            } else {
              _programMemory.root[variableName] = {
                type: 'userVal',
                value: result,
                __meta,
              }
            }
          } else {
            _programMemory.root[variableName] = {
              type: 'userVal',
              value: _programMemory.root[functionName].value(...fnArgs),
              __meta,
            }
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
        if (functionName in sketchFns) {
          if (options.bodyType !== 'sketch') {
            throw new Error(
              `Cannot call ${functionName} outside of a sketch declaration`
            )
          }
          const sketchFnName = functionName as SketchFnNames
          const result = sketchFns[sketchFnName](
            {
              programMemory: _programMemory,
              sourceRange: [statement.start, statement.end],
            },
            ...args
          )
          _programMemory._sketch = [...(result.programMemory._sketch || [])]
        } else if ('show' === functionName) {
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
  const getVal = (part: BinaryPart): any => {
    if (part.type === 'Literal') {
      return part.value
    } else if (part.type === 'Identifier') {
      return programMemory.root[part.name].value
    } else if (part.type === 'BinaryExpression') {
      return getBinaryExpressionResult(part, programMemory)
    }
  }
  const left = getVal(expression.left)
  const right = getVal(expression.right)
  if (expression.operator === '+') return left + right
  if (expression.operator === '-') return left - right
  if (expression.operator === '*') return left * right
  if (expression.operator === '/') return left / right
  if (expression.operator === '%') return left % right
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
  } else if (expression.type === 'SketchExpression') {
    const sketchBody = expression.body
    const fnMemory: ProgramMemory = {
      root: {
        ...programMemory.root,
      },
      _sketch: [],
    }
    let { _sketch } = executor(sketchBody, fnMemory, {
      bodyType: 'sketch',
    })
    const newSketch: SketchGroup = {
      type: 'sketchGroup',
      value: _sketch || [],
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1], //x,y,z,w
      __meta: [
        {
          sourceRange: [expression.start, expression.end],
          pathToNode: [...previousPathToNode, expressionIndex],
        },
      ],
    }
    return executePipeBody(
      body,
      programMemory,
      previousPathToNode,
      expressionIndex + 1,
      [...previousResults, newSketch]
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
        obj[property.key.name] = property.value.elements.map((el) => {
          if (el.type === 'Literal') {
            return el.value
          } else if (el.type === 'Identifier') {
            return _programMemory.root[el.name].value
          } else if (el.type === 'BinaryExpression') {
            return getBinaryExpressionResult(el, _programMemory)
          } else if (el.type === 'ObjectExpression') {
            return executeObjectExpression(_programMemory, el)
          }
          throw new Error('Invalid argument type')
        })
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
  const functionName = expression.callee.name
  const fnArgs = expression.arguments.map((arg) => {
    if (arg.type === 'Literal') {
      return arg.value
    } else if (arg.type === 'Identifier') {
      const temp = programMemory.root[arg.name]
      return temp?.type === 'userVal' ? temp.value : temp
    } else if (arg.type === 'PipeSubstitution') {
      return previousResults[expressionIndex - 1]
    } else if (arg.type === 'ArrayExpression') {
      return arg.elements.map((el) => {
        if (el.type === 'Literal') {
          return el.value
        } else if (el.type === 'Identifier') {
          return programMemory.root[el.name]
        } else if (el.type === 'BinaryExpression') {
          return getBinaryExpressionResult(el, programMemory)
        }
        throw new Error('Invalid argument type')
      })
    } else if (arg.type === 'CallExpression') {
      const result: any = executeCallExpression(
        programMemory,
        arg,
        previousPathToNode
      )
      return result
    }
    throw new Error('Invalid argument type')
  })
  if (
    functionName in internalFns &&
    [
      'rx',
      'ry',
      'rz',
      'translate',
      'transform',
      'extrude',
      'getExtrudeWallTransform',
    ].includes(functionName)
  ) {
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
  if (functionName in sketchFns) {
    const sketchFnName = functionName as SketchFnNames
    const result = sketchFns[sketchFnName](
      {
        programMemory,
        sourceRange: sourceRangeOverride || [expression.start, expression.end],
      },
      ...fnArgs
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
