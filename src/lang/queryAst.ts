import { PathToNode, ProgramMemory } from './executor'
import { Range } from '../useStore'
import { Program } from './abstractSyntaxTree'
import { splitPathAtLastIndex } from './modifyAst'

export function getNodeFromPath<T>(
  node: Program,
  path: PathToNode,
  stopAt: string = '',
  returnEarly = false
): {
  node: T
  path: PathToNode
} {
  let currentNode = node as any
  let stopAtNode = null
  let successfulPaths: PathToNode = []
  let pathsExplored: PathToNode = []
  for (const pathItem of path) {
    try {
      if (typeof currentNode[pathItem[0]] !== 'object')
        throw new Error('not an object')
      currentNode = currentNode[pathItem[0]]
      successfulPaths.push(pathItem)
      if (!stopAtNode) {
        pathsExplored.push(pathItem)
      }
      if (currentNode.type === stopAt) {
        // it will match the deepest node of the type
        // instead of returning at the first match
        stopAtNode = currentNode
        if (returnEarly) {
          return {
            node: stopAtNode,
            path: pathsExplored,
          }
        }
      }
    } catch (e) {
      console.error(
        `Could not find path ${pathItem} in node ${JSON.stringify(
          currentNode,
          null,
          2
        )}, successful path was ${successfulPaths}`
      )
    }
  }
  return {
    node: stopAtNode || currentNode,
    path: pathsExplored,
  }
}

export function getNodeFromPathCurry(
  node: Program,
  path: PathToNode
): <T>(
  stopAt: string,
  returnEarly?: boolean
) => {
  node: T
  path: PathToNode
} {
  return <T>(stopAt: string = '', returnEarly = false) => {
    return getNodeFromPath<T>(node, path, stopAt, returnEarly)
  }
}

export function getNodePathFromSourceRange(
  node: Program,
  sourceRange: Range,
  previousPath: PathToNode = []
): PathToNode {
  const [start, end] = sourceRange
  let path: PathToNode = [...previousPath, ['body', '']]
  const _node = { ...node }
  // loop over each statement in body getting the index with a for loop
  for (
    let statementIndex = 0;
    statementIndex < _node.body.length;
    statementIndex++
  ) {
    const statement = _node.body[statementIndex]
    if (statement.start <= start && statement.end >= end) {
      path.push([statementIndex, 'index'])
      if (statement.type === 'ExpressionStatement') {
        const expression = statement.expression
        if (expression.start <= start && expression.end >= end) {
          path.push(['expression', 'ExpressionStatement'])
          if (expression.type === 'CallExpression') {
            const callee = expression.callee
            if (callee.start <= start && callee.end >= end) {
              path.push(['callee', 'CallExpression'])
              if (callee.type === 'Identifier') {
              }
            }
          }
        }
      } else if (statement.type === 'VariableDeclaration') {
        const declarations = statement.declarations

        for (let decIndex = 0; decIndex < declarations.length; decIndex++) {
          const declaration = declarations[decIndex]

          if (declaration.start <= start && declaration.end >= end) {
            path.push(['declarations', 'VariableDeclaration'])
            path.push([decIndex, 'index'])
            const init = declaration.init
            if (init.start <= start && init.end >= end) {
              path.push(['init', ''])
              if (init.type === 'PipeExpression') {
                const body = init.body
                for (let pipeIndex = 0; pipeIndex < body.length; pipeIndex++) {
                  const pipe = body[pipeIndex]
                  if (pipe.start <= start && pipe.end >= end) {
                    path.push(['body', 'PipeExpression'])
                    path.push([pipeIndex, 'index'])
                  }
                  if (
                    pipe.type === 'CallExpression' &&
                    pipe.start <= start &&
                    pipe.end >= end
                  ) {
                    if (pipe.callee.start <= start && pipe.callee.end >= end) {
                      path.push(['callee', 'CallExpression'])
                    } else {
                      for (
                        let argIndex = 0;
                        argIndex < pipe.arguments.length;
                        argIndex++
                      ) {
                        const arg = pipe.arguments[argIndex]
                        if (arg.start <= start && arg.end >= end) {
                          path.push(['arguments', 'CallExpression'])
                          path.push([argIndex, 'index'])
                          if (arg.type === 'ArrayExpression') {
                            const elements = arg.elements
                            for (
                              let elIndex = 0;
                              elIndex < elements.length;
                              elIndex++
                            ) {
                              const el = elements[elIndex]
                              if (el.start <= start && el.end >= end) {
                                path.push(['elements', 'ArrayExpression'])
                                path.push([elIndex, 'index'])
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              } else if (init.type === 'CallExpression') {
                const callee = init.callee
                if (callee.start <= start && callee.end >= end) {
                  path.push(['callee', 'CallExpression'])
                  if (callee.type === 'Identifier') {
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return path
}

export interface PrevVariable<T> {
  key: string
  value: T
}

export function findAllPreviousVariables(
  ast: Program,
  programMemory: ProgramMemory,
  sourceRange: Range,
  type: 'number' | 'string' = 'number'
): {
  variables: PrevVariable<typeof type extends 'number' ? number : string>[]
  bodyPath: PathToNode
  insertIndex: number
} {
  const path = getNodePathFromSourceRange(ast, sourceRange)
  const { path: pathToDec } = getNodeFromPath(ast, path, 'VariableDeclaration')
  const { index: insertIndex, path: bodyPath } = splitPathAtLastIndex(pathToDec)

  const { node: bodyItems } = getNodeFromPath<Program['body']>(ast, bodyPath)

  const variables: PrevVariable<any>[] = []
  bodyItems?.forEach?.((item) => {
    if (item.type !== 'VariableDeclaration' || item.end > sourceRange[0]) return
    const varName = item.declarations[0].id.name
    const varValue = programMemory?.root[varName]
    if (typeof varValue?.value !== type) return
    variables.push({
      key: varName,
      value: varValue.value,
    })
  })

  return {
    insertIndex,
    bodyPath: bodyPath,
    variables,
  }
}
