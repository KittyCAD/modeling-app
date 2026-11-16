import { evaluateCommandArgumentFlags } from '@src/components/CommandBar/utils'
import { hasValue } from '@src/components/ModelingDialog/arguments'
import type { Command, CommandArgumentConfig } from '@src/lib/commandTypes'
import { isKclCommandValue } from '@src/lib/commandUtils'
import { isSelections } from '@src/lib/selections'
import { isPathToNode } from '@src/lang/wasm'

export type ToolArguments<Args extends object> = {
  [Key in keyof Args]: CommandArgumentConfig<Args[Key], unknown>
}

/** Parse the resolved schema at the untyped command boundary before handing values to a codemod. */
export function parseToolArguments<Args extends object>(
  schema: ToolArguments<Args>,
  values: Record<string, unknown>,
  fields: NonNullable<Command['args']>
): Args | Error {
  const parsed: Record<string, unknown> = {}
  const context = { argumentsToSubmit: values }
  for (const name of Object.keys(schema)) {
    const arg = fields[name]
    if (!arg) {
      if (values[name] !== undefined)
        return new Error(`The argument ${name} is unavailable for this model.`)
      continue
    }
    const value = values[name]
    const { isRequired } = evaluateCommandArgumentFlags(arg, context)
    if (value === undefined || value === null || value === '') {
      if (isRequired) return new Error(`Enter ${arg.displayName || name}.`)
      continue
    }
    let valid: boolean
    if (name === 'nodeToEdit') {
      valid = isPathToNode(value)
    } else {
      switch (arg.inputType) {
        case 'selection':
          valid = isSelections(value) && (!isRequired || hasValue(value))
          break
        case 'kcl':
        case 'vector2d':
        case 'vector3d':
          valid =
            isKclCommandValue(value) &&
            (value.valueCalculated !== 'NAN' ||
              (arg.inputType === 'kcl' && Boolean(arg.allowUncalculated)))
          break
        case 'options': {
          const options =
            typeof arg.options === 'function'
              ? arg.options(context)
              : arg.options
          valid = options.some((option) => option.value === value)
          break
        }
        case 'boolean':
          valid = typeof value === 'boolean'
          break
        case 'number':
          valid = typeof value === 'number' && Number.isFinite(value)
          break
        case 'camera':
          return new Error('Camera arguments need a camera-aware command host.')
        case 'string':
        case 'path':
        case 'text':
        case 'color':
        case 'tagDeclarator':
          valid = typeof value === 'string'
          break
      }
    }
    if (!valid)
      return new Error(`Invalid value for ${arg.displayName || name}.`)
    parsed[name] = value
  }
  // The typed schema ties these field parsers to the codemod's argument type.
  return parsed as Args
}
