import { executeAstMock } from '@src/lang/langHelpers'
import {
  formatNumberValue,
  parse,
  resultIsOk,
  type SourceRange,
} from '@src/lang/wasm'
import type { KclExpression } from '@src/lib/commandTypes'
import { rustContext } from '@src/lib/singletons'
import { err } from '@src/lib/trap'

const DUMMY_VARIABLE_NAME = '__result__'

/**
 * Calculate the value of the KCL expression,
 * given the value and the variables that are available in memory.
 */
export async function getCalculatedKclExpressionValue(
  value: string,
  allowArrays: boolean = false
) {
  // Create a one-line program that assigns the value to a variable
  const dummyProgramCode = `${DUMMY_VARIABLE_NAME} = ${value}`
  const pResult = parse(dummyProgramCode)
  if (err(pResult) || !resultIsOk(pResult)) return pResult
  const ast = pResult.program

  // Execute the program without hitting the engine
  const { execState } = await executeAstMock({
    ast,
    rustContext: rustContext,
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
  const varValue = execState.variables[DUMMY_VARIABLE_NAME]

  // Handle array values when allowArrays is true
  if (
    allowArrays &&
    varValue &&
    (varValue.type === 'Tuple' || varValue.type === 'HomArray')
  ) {
    const arrayValues = varValue.value.map((item: any) => {
      if (item.type === 'Number') {
        const formatted = formatNumberValue(item.value, item.ty)
        if (!err(formatted)) {
          return formatted
        }
        return String(item.value)
      }
      return String(item.value)
    })

    const valueAsString = `[${arrayValues.join(', ')}]`

    return {
      astNode: variableDeclaratorAstNode,
      valueAsString,
    }
  }

  // If the value is a number, attempt to format it with units.
  const resultValueWithUnits = (() => {
    if (!varValue || varValue.type !== 'Number') {
      return undefined
    }
    const formatted = formatNumberValue(varValue.value, varValue.ty)
    if (err(formatted)) return undefined
    return formatted
  })()
  // Prefer the formatted value with units.  Fallback to the raw value.
  const resultRawValue = varValue?.value
  const valueAsString = resultValueWithUnits
    ? resultValueWithUnits
    : typeof resultRawValue === 'number'
      ? String(resultRawValue)
      : 'NAN'

  return {
    astNode: variableDeclaratorAstNode,
    valueAsString,
  }
}

export async function stringToKclExpression(
  value: string,
  allowArrays: boolean = false
) {
  const calculatedResult = await getCalculatedKclExpressionValue(
    value,
    allowArrays
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

export function getStringValue(code: string, range: SourceRange): string {
  return code.slice(range[0], range[1]).replaceAll(`'`, ``).replaceAll(`"`, ``)
}
