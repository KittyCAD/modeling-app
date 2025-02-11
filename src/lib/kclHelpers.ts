import { err } from './trap'
import { engineCommandManager } from 'lib/singletons'
import { parse, ProgramMemory, programMemoryInit, resultIsOk } from 'lang/wasm'
import { PrevVariable } from 'lang/queryAst'
import { executeAst } from 'lang/langHelpers'
import { KclExpression } from './commandTypes'

const DUMMY_VARIABLE_NAME = '__result__'

export function programMemoryFromVariables(
  variables: PrevVariable<string | number>[]
): ProgramMemory | Error {
  const memory = programMemoryInit()
  if (err(memory)) return memory
  for (const { key, value } of variables) {
    const error = memory.set(
      key,
      typeof value === 'number'
        ? {
            type: 'Number',
            value,
            __meta: [],
          }
        : {
            type: 'String',
            value,
            __meta: [],
          }
    )
    if (err(error)) return error
  }
  return memory
}

/**
 * Calculate the value of the KCL expression,
 * given the value and the variables that are available
 */
export async function getCalculatedKclExpressionValue({
  value,
  programMemory,
}: {
  value: string
  programMemory: ProgramMemory
}) {
  // Create a one-line program that assigns the value to a variable
  const dummyProgramCode = `const ${DUMMY_VARIABLE_NAME} = ${value}`
  const pResult = parse(dummyProgramCode)
  if (err(pResult) || !resultIsOk(pResult)) return pResult
  const ast = pResult.program

  // Execute the program without hitting the engine
  const { execState } = await executeAst({
    ast,
    engineCommandManager,
    programMemoryOverride: programMemory,
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
  const resultRawValue = execState.memory?.get(DUMMY_VARIABLE_NAME)?.value

  return {
    astNode: variableDeclaratorAstNode,
    valueAsString:
      typeof resultRawValue === 'number' ? String(resultRawValue) : 'NAN',
  }
}

export async function stringToKclExpression({
  value,
  programMemory,
}: {
  value: string
  programMemory: ProgramMemory
}) {
  const calculatedResult = await getCalculatedKclExpressionValue({
    value,
    programMemory,
  })
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
