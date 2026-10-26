/** GDT command text is written as a double-quoted KCL string literal. */
export async function validateGdtText({ data }: { data: unknown }) {
  if (typeof data !== 'string') return 'Enter GD&T text to continue.'
  if (data.includes('"')) {
    return 'Double quotes are not supported in GD&T text. Remove them to continue.'
  }
  if (data.includes('\\')) {
    return 'Backslashes are not supported in GD&T text. Remove them to continue.'
  }
  if (/[\n\r\t]/.test(data)) {
    return 'GD&T text must be a single line without tabs.'
  }
  return true
}
