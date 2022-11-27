import { Program, BinaryPart, BinaryExpression } from './abstractSyntaxTree'
import { Path, sketchFns } from './sketch'

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
        if (declaration.init.type === 'Literal') {
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
            const {programMemory: newProgramMemory} = sketchFns.base(fnMemory, '', [0, 0], 0, 0)
            _sketch = newProgramMemory._sketch
          }
          _programMemory.root[variableName] = _sketch
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
