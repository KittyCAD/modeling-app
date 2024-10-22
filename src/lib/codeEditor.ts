export const normalizeLineEndings = (str: string, normalized = '\n') => {
  return str.replace(/\r?\n/g, normalized)
}
