import type { Operation, OpKclValue } from '@rust/kcl-lib/bindings/Operation'
import { toUtf16 } from '@src/lang/errors'
import { stripQuotes } from '@src/lib/utils'

/**
 * Helper function to get value detail for operations (variable declarations,
 * datums, and named views)
 * @param operation - The operation to extract value detail from
 * @param code - The source code string to extract values from
 * @returns Value detail object with display string and calculated value, or undefined if no value
 */
export function getFeatureTreeValueDetail(
  operation: Operation,
  code: string
): { calculated: OpKclValue; display: string } | undefined {
  if (operation.type === 'VariableDeclaration') {
    return {
      display: code.slice(
        ...operation.sourceRange.map((r) => toUtf16(r, code))
      ),
      calculated: operation.value,
    }
  }

  // Show datum name for GDT Datum operations
  if (operation.type === 'StdLibCall' && operation.name === 'gdt::datum') {
    const nameArg = operation.labeledArgs?.name
    if (nameArg?.sourceRange) {
      const nameRaw = code.slice(
        ...nameArg.sourceRange.map((r) => toUtf16(r, code))
      )
      const datumName = stripQuotes(nameRaw)
      if (datumName) {
        const stringValue: OpKclValue = {
          type: 'String',
          value: datumName,
        }
        return {
          display: datumName,
          calculated: stringValue,
        }
      }
    }
  }

  // Show the view name from the unlabeled first argument
  if (operation.type === 'StdLibCall' && operation.name === 'view::named') {
    const nameArg = operation.unlabeledArg
    if (nameArg?.value.type === 'String') {
      return {
        display: code.slice(
          ...nameArg.sourceRange.map((r) => toUtf16(r, code))
        ),
        calculated: nameArg.value,
      }
    }
  }

  return undefined
}
