// Some command argument payloads are objects with a value field that is a KCL expression.
// That object also contains some metadata about what to do with the KCL expression,
// such as whether we need to create a new variable for it.
// This function extracts the value field from those arg payloads and returns
// The arg object with all its field as natural values that the command to be executed will expect.
export function getCommandArgumentKclValuesOnly(args: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => {
      if (value !== null && typeof value === 'object' && 'value' in value) {
        return [key, value.value]
      }
      return [key, value]
    })
  )
}
