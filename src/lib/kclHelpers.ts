import { err, trap } from './trap'
import { engineCommandManager, kclManager } from 'lib/singletons'
import { parse, ProgramMemory, resultIsOk } from 'lang/wasm'
import { PrevVariable } from 'lang/queryAst'
import { executeAst } from 'lang/langHelpers'

const DUMMY_VARIABLE_NAME = '__result__'

/**
 * Calculate the value of the KCL expression,
 * given the value and the variables that are available
 */
export async function getCalculatedKclExpressionValue({
  value,
  variables,
}: {
  value: string
  variables: PrevVariable<string | number>[]
}) {
  // Create a one-line program that assigns the value to a variable
  const dummyProgramCode = `const ${DUMMY_VARIABLE_NAME} = ${value}`
  const pResult = parse(dummyProgramCode)
  if (err(pResult) || !resultIsOk(pResult)) return
  const ast = pResult.program

  // Populate the program memory with the passed-in variables
  const programMemoryOverride: ProgramMemory = ProgramMemory.empty()
  for (const { key, value } of variables) {
    const error = programMemoryOverride.set(
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
    if (trap(error, { suppress: true })) return
  }

  console.log(
    'programMemoryOverride',
    JSON.stringify(programMemoryOverride, null, 2)
  )

  // Execute the program without hitting the engine
  const { execState } = await executeAst({
    ast,
    engineCommandManager,
    programMemoryOverride,
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
