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
  variables: PrevVariable<string>[]
}) {
  // Create a one-line program that assigns the value to a variable
  const dummyProgramCode = `const ${DUMMY_VARIABLE_NAME} = ${value}`
  const pResult = parse(dummyProgramCode)
  if (err(pResult) || !resultIsOk(pResult)) return
  const ast = pResult.program

  // Populate the program memory with the passed-in variables
  const _programMem: ProgramMemory = ProgramMemory.empty()
  for (const { key, value } of variables) {
    const error = _programMem.set(key, {
      type: 'String',
      value,
      __meta: [],
    })
    if (trap(error, { suppress: true })) return
  }

  // Execute the program without hitting the engine
  const { execState } = await executeAst({
    ast,
    engineCommandManager,
    // We make sure to send an empty program memory to denote we mean mock mode.
    programMemoryOverride: kclManager.programMemory.clone(),
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
