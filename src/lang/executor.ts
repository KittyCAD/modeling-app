import {
  Program,
  BinaryPart,
  BinaryExpression,
  PipeExpression,
} from './abstractSyntaxTree'
import { Path, Transform, SketchGeo, sketchFns, ExtrudeGeo } from './sketch'
import { BufferGeometry, Quaternion, Vector3 } from 'three'
import { LineGeos } from './engine'

export interface ProgramMemory {
  root: { [key: string]: any }
  return?: any
  _sketch: Path[]
}

export const executor = (
  node: Program,
  programMemory: ProgramMemory = { root: {}, _sketch: [] },
  options: { bodyType: 'root' | 'sketch' | 'block' } = { bodyType: 'root' }
): ProgramMemory => {
  const _programMemory: ProgramMemory = {
    root: {
      ...programMemory.root,
    },
    _sketch: [],
    return: programMemory.return,
  }
  const { body } = node
  body.forEach((statement) => {
    if (statement.type === 'VariableDeclaration') {
      statement.declarations.forEach((declaration) => {
        const variableName = declaration.id.name
        if (declaration.init.type === 'PipeExpression') {
          _programMemory.root[variableName] = getPipeExpressionResult(
            declaration.init,
            _programMemory
          )
        } else if (declaration.init.type === 'Literal') {
          _programMemory.root[variableName] = declaration.init.value
        } else if (declaration.init.type === 'BinaryExpression') {
          _programMemory.root[variableName] = getBinaryExpressionResult(
            declaration.init,
            _programMemory
          )
        } else if (declaration.init.type === 'ArrayExpression') {
          _programMemory.root[variableName] = declaration.init.elements.map(
            (element) => {
              if (element.type === 'Literal') {
                return element.value
              } else if (element.type === 'BinaryExpression') {
                return getBinaryExpressionResult(element, _programMemory)
              } else if (element.type === 'PipeExpression') {
                return getPipeExpressionResult(element, _programMemory)
              } else if (element.type === 'Identifier') {
                return _programMemory.root[element.name]
              } else {
                throw new Error(
                  `Unexpected element type ${element.type} in array expression`
                )
              }
            }
          )
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
          if (_sketch.length === 0) {
            const { programMemory: newProgramMemory } = sketchFns.base(
              fnMemory,
              '',
              [0, 0],
              0,
              0
            )
            _sketch = newProgramMemory._sketch
          }
          const newSketch: SketchGeo = {
            type: 'sketchGeo',
            sketch: _sketch,
            sourceRange: [sketchInit.start, sketchInit.end],
          }
          _programMemory.root[variableName] = newSketch
        } else if (declaration.init.type === 'FunctionExpression') {
          const fnInit = declaration.init

          _programMemory.root[declaration.id.name] = (...args: any[]) => {
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
              fnMemory.root[param.name] = args[index]
            })
            return executor(fnInit.body, fnMemory, { bodyType: 'block' }).return
          }
        } else if (declaration.init.type === 'CallExpression') {
          const functionName = declaration.init.callee.name
          const fnArgs = declaration.init.arguments.map((arg) => {
            if (arg.type === 'Literal') {
              return arg.value
            } else if (arg.type === 'Identifier') {
              return _programMemory.root[arg.name]
            }
          })
          if (
            'lineTo' === functionName ||
            'close' === functionName ||
            'base' === functionName
          ) {
            if (options.bodyType !== 'sketch') {
              throw new Error(
                `Cannot call ${functionName} outside of a sketch declaration`
              )
            }
            const result = sketchFns[functionName](
              _programMemory,
              variableName,
              [declaration.start, declaration.end],
              ...fnArgs
            )
            _programMemory._sketch = result.programMemory._sketch
            _programMemory.root[variableName] = result.currentPath
          } else if (
            'rx' === functionName ||
            'ry' === functionName ||
            'rz' === functionName
          ) {
            const sketch = declaration.init.arguments[1]
            if (sketch.type !== 'Identifier')
              throw new Error('rx must be called with an identifier')
            const sketchVal = _programMemory.root[sketch.name]
            const result = sketchFns[functionName](
              _programMemory,
              [declaration.start, declaration.end],
              fnArgs[0],
              sketchVal
            )
            _programMemory.root[variableName] = result
          } else if (functionName === 'extrude') {
            const sketch = declaration.init.arguments[1]
            if (sketch.type !== 'Identifier')
              throw new Error('extrude must be called with an identifier')
            const sketchVal = _programMemory.root[sketch.name]
            const result = sketchFns[functionName](
              _programMemory,
              'yo',
              [declaration.start, declaration.end],
              fnArgs[0],
              sketchVal
            )
            _programMemory.root[variableName] = result
          } else if (functionName === 'translate') {
            const sketch = declaration.init.arguments[1]
            if (sketch.type !== 'Identifier')
              throw new Error('rx must be called with an identifier')
            const sketchVal = _programMemory.root[sketch.name]
            const result = sketchFns[functionName](
              _programMemory,
              [declaration.start, declaration.end],
              fnArgs[0],
              sketchVal
            )
            _programMemory.root[variableName] = result
          } else {
            _programMemory.root[variableName] = _programMemory.root[
              functionName
            ](...fnArgs)
          }
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
            return _programMemory.root[arg.name]
          }
        })
        if (
          'lineTo' === functionName ||
          'close' === functionName ||
          'base' === functionName
        ) {
          if (options.bodyType !== 'sketch') {
            throw new Error(
              `Cannot call ${functionName} outside of a sketch declaration`
            )
          }
          const result = sketchFns[functionName](
            _programMemory,
            '',
            [statement.start, statement.end],
            ...args
          )
          _programMemory._sketch = [...result.programMemory._sketch]
        } else if ('show' === functionName) {
          if (options.bodyType !== 'root') {
            throw new Error(`Cannot call ${functionName} outside of a root`)
          }
          _programMemory.return = expression.arguments
        } else {
          _programMemory.root[functionName](...args)
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

function getBinaryExpressionResult(
  expression: BinaryExpression,
  programMemory: ProgramMemory
) {
  const getVal = (part: BinaryPart) => {
    if (part.type === 'Literal') {
      return part.value
    } else if (part.type === 'Identifier') {
      return programMemory.root[part.name]
    }
  }
  const left = getVal(expression.left)
  const right = getVal(expression.right)
  return left + right
}

function getPipeExpressionResult(
  expression: PipeExpression,
  programMemory: ProgramMemory
) {
  const executedBody = executePipeBody(expression.body, programMemory)
  const result = executedBody[executedBody.length - 1]
  return result
}

function executePipeBody(
  body: PipeExpression['body'],
  programMemory: ProgramMemory,
  expressionIndex = 0,
  previousResults: any[] = []
): any[] {
  if (expressionIndex === body.length) {
    return previousResults
  }
  const expression = body[expressionIndex]
  if (expression.type === 'BinaryExpression') {
    const result = getBinaryExpressionResult(expression, programMemory)
    return executePipeBody(body, programMemory, expressionIndex + 1, [
      ...previousResults,
      result,
    ])
  } else if (expression.type === 'CallExpression') {
    const functionName = expression.callee.name
    const fnArgs = expression.arguments.map((arg) => {
      if (arg.type === 'Literal') {
        return arg.value
      } else if (arg.type === 'Identifier') {
        return programMemory.root[arg.name]
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
      }
      throw new Error('Invalid argument type')
    })
    if (
      'rx' === functionName ||
      'ry' === functionName ||
      'rz' === functionName
    ) {
      const result = sketchFns[functionName](
        programMemory,
        [expression.start, expression.end],
        fnArgs[0],
        fnArgs[1]
      )
      return executePipeBody(body, programMemory, expressionIndex + 1, [
        ...previousResults,
        result,
      ])
    }
    if (functionName === 'extrude') {
      const result = sketchFns[functionName](
        programMemory,
        'yo',
        [expression.start, expression.end],
        fnArgs[0],
        fnArgs[1]
      )
      return executePipeBody(body, programMemory, expressionIndex + 1, [
        ...previousResults,
        result,
      ])
    }
    if (functionName === 'translate') {
      const result = sketchFns[functionName](
        programMemory,
        [expression.start, expression.end],
        fnArgs[0],
        fnArgs[1]
      )
      return executePipeBody(body, programMemory, expressionIndex + 1, [
        ...previousResults,
        result,
      ])
    }
    const result = programMemory.root[functionName](...fnArgs)
    return executePipeBody(body, programMemory, expressionIndex + 1, [
      ...previousResults,
      result,
    ])
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
    if (_sketch.length === 0) {
      const { programMemory: newProgramMemory } = sketchFns.base(
        fnMemory,
        '',
        [0, 0],
        0,
        0
      )
      _sketch = newProgramMemory._sketch
    }
    // _programMemory.root[variableName] = _sketch
    const newSketch: SketchGeo = {
      type: 'sketchGeo',
      sketch: _sketch,
      sourceRange: [expression.start, expression.end],
    }
    return executePipeBody(body, programMemory, expressionIndex + 1, [
      ...previousResults,
      newSketch,
    ])
  }

  throw new Error('Invalid pipe expression')
}

type SourceRange = [number, number]

export type ViewerArtifact =
  | {
      type: 'sketchLine'
      sourceRange: SourceRange
      geo: LineGeos
    }
  | {
      type: 'sketchBase'
      sourceRange: SourceRange
      geo: BufferGeometry
    }
  | {
      type: 'extrudeWall'
      sourceRange: SourceRange
      geo: BufferGeometry
    }
  | {
      type: 'parent'
      sourceRange: SourceRange
      children: ViewerArtifact[]
    }
  | {
      type: 'sketch'
      sourceRange: SourceRange
      children: ViewerArtifact[]
    }

type PreviousTransforms = {
  rotation: Quaternion
  transform: [number, number, number]
}[]

export const processShownObjects = (
  programMemory: ProgramMemory,
  geoMeta: SketchGeo | ExtrudeGeo | Transform,
  previousTransforms: PreviousTransforms = []
): ViewerArtifact[] => {
  if (geoMeta?.type === 'sketchGeo') {
    return [
      {
        type: 'sketch',
        sourceRange: geoMeta.sourceRange,
        children: geoMeta.sketch.map(({ geo, sourceRange, type }) => {
          if (type === 'toPoint') {
            const newGeo: LineGeos = {
              line: geo.line.clone(),
              tip: geo.tip.clone(),
              centre: geo.centre.clone(),
            }
            let rotationQuaternion = new Quaternion()
            let position = new Vector3(0, 0, 0)
            previousTransforms.forEach(({ rotation, transform }) => {
              const newQuant = rotation.clone()
              newQuant.multiply(rotationQuaternion)
              rotationQuaternion.copy(newQuant)
              position.applyQuaternion(rotation)
              position.add(new Vector3(...transform))
            })
            Object.values(newGeo).forEach((geoItem: BufferGeometry) => {
              geoItem.applyQuaternion(rotationQuaternion.clone())
              const position_ = position.clone()
              geoItem.translate(position_.x, position_.y, position_.z)
            })
            return {
              type: 'sketchLine',
              geo: newGeo,
              sourceRange,
            }
          } else if (type === 'base') {
            const newGeo: BufferGeometry = geo.clone()
            const rotationQuaternion = new Quaternion()
            let position = new Vector3(0, 0, 0)
            // todo don't think this is right
            previousTransforms.forEach(({ rotation, transform }) => {
              newGeo.applyQuaternion(rotationQuaternion)
              newGeo.translate(position.x, position.y, position.z)
            })
            newGeo.applyQuaternion(rotationQuaternion)
            newGeo.translate(position.x, position.y, position.z)
            return {
              type: 'sketchBase',
              geo: newGeo,
              sourceRange,
            }
          }
          throw new Error('Unknown geo type')
        }),
      },
    ]
  } else if (geoMeta.type === 'transform') {
    const referencedVar = geoMeta.sketch
    const parentArtifact: ViewerArtifact = {
      type: 'parent',
      sourceRange: geoMeta.sourceRange,
      children: processShownObjects(programMemory, referencedVar, [
        {
          rotation: geoMeta.rotation,
          transform: geoMeta.transform,
        },
        ...previousTransforms,
      ]),
    }
    return [parentArtifact]
  } else if (geoMeta.type === 'extrudeGeo') {
    const result: ViewerArtifact[] = geoMeta.surfaces.map((a) => {
      const geo: BufferGeometry = a.geo.clone()

      geo.translate(a.translate[0], a.translate[1], a.translate[2])
      geo.applyQuaternion(a.quaternion)
      return {
        type: 'extrudeWall',
        sourceRange: a.sourceRanges[0],
        geo,
      }
    })
    return result
  }
  throw new Error('Unknown geoMeta type')
}
