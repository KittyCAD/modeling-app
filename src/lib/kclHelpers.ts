import { err } from './trap'
import { engineCommandManager } from 'lib/singletons'
import { parse, resultIsOk, VariableMap } from 'lang/wasm'
import { PrevVariable } from 'lang/queryAst'
import { executeAst } from 'lang/langHelpers'
import { KclExpression } from './commandTypes'

const DUMMY_VARIABLE_NAME = '__result__'

/**
 * Calculate the value of the KCL expression,
 * given the value and the variables that are available
 */
export async function getCalculatedKclExpressionValue(
  value: string,
  variables: VariableMap
) {
  // Create a one-line program that assigns the value to a variable
  const dummyProgramCode = `const ${DUMMY_VARIABLE_NAME} = ${value}`
  const pResult = parse(dummyProgramCode)
  if (err(pResult) || !resultIsOk(pResult)) return pResult
  const ast = pResult.program

  // Execute the program without hitting the engine
  const { execState } = await executeAst({
    ast,
    engineCommandManager,
    isMock: true,
    variables,
  })

  // Find the variable declaration for the result
  const resultDeclaration = ast.body.find(
    (a) =>
      a.type === 'VariableDeclaration' &&
      a.declaration.id?.name === DUMMY_VARIABLE_NAME
  )
  const variableDeclaratorAstNode =
    resultDeclaration?.type === 'VariableDeclaration' &&
    resultDeclaration?.declaration.init
  const resultRawValue = execState.variables[DUMMY_VARIABLE_NAME]?.value

  return {
    astNode: variableDeclaratorAstNode,
    valueAsString:
      typeof resultRawValue === 'number' ? String(resultRawValue) : 'NAN',
  }
}

export async function stringToKclExpression(
  value: string,
  variables: VariableMap
) {
  const calculatedResult = await getCalculatedKclExpressionValue(
    value,
    variables
  )
  if (err(calculatedResult) || 'errors' in calculatedResult) {
    return calculatedResult
  } else if (!calculatedResult.astNode) {
    return new Error('Failed to calculate KCL expression')
  }
  return {
    valueAst: calculatedResult.astNode,
    valueCalculated: calculatedResult.valueAsString,
    valueText: value,
  } satisfies KclExpression
}
