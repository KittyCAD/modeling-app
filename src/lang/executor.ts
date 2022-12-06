import {
  Program,
  BinaryPart,
  BinaryExpression,
  PipeExpression,
} from './abstractSyntaxTree'
import { Path, Transform, SketchGeo, sketchFns } from './sketch'
import { BufferGeometry } from 'three'
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
          const fnName = declaration.init.callee.name
          const fnArgs = declaration.init.arguments.map((arg) => {
            if (arg.type === 'Literal') {
              return arg.value
            } else if (arg.type === 'Identifier') {
              return _programMemory.root[arg.name]
            }
          })
          if ('lineTo' === fnName || 'close' === fnName || 'base' === fnName) {
            if (options.bodyType !== 'sketch') {
              throw new Error(
                `Cannot call ${fnName} outside of a sketch declaration`
              )
            }
            const result = sketchFns[fnName](
              _programMemory,
              variableName,
              [declaration.start, declaration.end],
              ...fnArgs
            )
            _programMemory._sketch = result.programMemory._sketch
            _programMemory.root[variableName] = result.currentPath
          } else if ('rx' === fnName || 'ry' === fnName || 'rz' === fnName) {
            const sketch = declaration.init.arguments[1]
            if (sketch.type !== 'Identifier')
              throw new Error('rx must be called with an identifier')
            const sketchVal = _programMemory.root[sketch.name]
            const result = sketchFns[fnName](
              _programMemory,
              [declaration.start, declaration.end],
              fnArgs[0],
              sketchVal
            )
            _programMemory.root[variableName] = result
          } else {
            _programMemory.root[variableName] = _programMemory.root[fnName](
              ...fnArgs
            )
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
    const fnName = expression.callee.name
    const fnArgs = expression.arguments.map((arg) => {
      if (arg.type === 'Literal') {
        return arg.value
      } else if (arg.type === 'Identifier') {
        return programMemory.root[arg.name]
      } else if (arg.type === 'PipeSubstitution') {
        return previousResults[expressionIndex - 1]
      }
      throw new Error('Invalid argument type')
    })
    if ('rx' === fnName || 'ry' === fnName || 'rz' === fnName) {
      const result = sketchFns[fnName](
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
    const result = programMemory.root[fnName](...fnArgs)
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
      type: 'sketchBase',
      sourceRange: SourceRange,
      geo: BufferGeometry
  }
  | {
      type: 'parent'
      sourceRange: SourceRange
      children: ViewerArtifact[]
    }

type PreviousTransforms = {
  rotation: [number, number, number]
  transform: [number, number, number]
}[]

export const processShownObjects = (
  programMemory: ProgramMemory,
  geoMeta: SketchGeo | Transform,
  previousTransforms: PreviousTransforms = []
): ViewerArtifact[] => {
  if (geoMeta?.type === 'sketchGeo') {
    return geoMeta.sketch.map(({ geo, sourceRange, type }) => {
      if(type === 'toPoint') {
        // const newGeo = geo.clone()
        const newGeo: LineGeos = {
            line: geo.line.clone(),
            tip: geo.tip.clone(),
            centre: geo.centre.clone(),
        }
        previousTransforms.forEach(({ rotation, transform }) => {
          Object.values(newGeo).forEach((geoItem) => {
            geoItem.rotateX(rotation[0])
            geoItem.rotateY(rotation[1])
            geoItem.rotateZ(rotation[2])
            geoItem.translate(transform[0], transform[1], transform[2])
          })
        })
        return {
          type: 'sketchLine',
          geo: newGeo,
          sourceRange,
        }
      } else if(type === 'base') {
        const newGeo = geo.clone()
        previousTransforms.forEach(({ rotation, transform }) => {
          newGeo.rotateX(rotation[0])
          newGeo.rotateY(rotation[1])
          newGeo.rotateZ(rotation[2])
          newGeo.translate(transform[0], transform[1], transform[2])
        })
        return {
          type: 'sketchBase',
          geo: newGeo,
          sourceRange,
        }
      }
      console.log('type',type)
      
      throw new Error('Unknown geo type')
    })
  } else if (geoMeta.type === 'transform') {
    const referencedVar = geoMeta.sketch
    const parentArtifact: ViewerArtifact = {
      type: 'parent',
      sourceRange: geoMeta.sourceRange,
      children: processShownObjects(programMemory, referencedVar, [
        ...previousTransforms,
        {
          rotation: geoMeta.rotation,
          transform: geoMeta.transform,
        },
      ]),
    }
    return [parentArtifact]
  }

  throw new Error('Unknown geoMeta type')
}
