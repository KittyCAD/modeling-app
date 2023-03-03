import { PathToNode } from './executor'
import { Range } from '../useStore'
import { Program } from './abstractSyntaxTree'

export function getNodeFromPath<T>(
  node: Program,
  path: (string | number)[],
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
      if (typeof currentNode[pathItem] !== 'object')
        throw new Error('not an object')
      currentNode = currentNode[pathItem]
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
  path: (string | number)[]
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
  let path: PathToNode = [...previousPath, 'body']
  const _node = { ...node }
  // loop over each statement in body getting the index with a for loop
  for (
    let statementIndex = 0;
    statementIndex < _node.body.length;
    statementIndex++
  ) {
    const statement = _node.body[statementIndex]
    if (statement.start <= start && statement.end >= end) {
      path.push(statementIndex)
      if (statement.type === 'ExpressionStatement') {
        const expression = statement.expression
        if (expression.start <= start && expression.end >= end) {
          path.push('expression')
          if (expression.type === 'CallExpression') {
            const callee = expression.callee
            if (callee.start <= start && callee.end >= end) {
              path.push('callee')
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
            path.push('declarations')
            path.push(decIndex)
            const init = declaration.init
            if (init.start <= start && init.end >= end) {
              path.push('init')
              if (init.type === 'PipeExpression') {
                const body = init.body
                for (let pipeIndex = 0; pipeIndex < body.length; pipeIndex++) {
                  const pipe = body[pipeIndex]
                  if (pipe.start <= start && pipe.end >= end) {
                    path.push('body')
                    path.push(pipeIndex)
                  }
                }
              } else if (init.type === 'CallExpression') {
                const callee = init.callee
                if (callee.start <= start && callee.end >= end) {
                  path.push('callee')
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
