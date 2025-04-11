import bracket from '@public/kcl-samples/bracket/main.kcl?raw'

export { bracket }

/**
 * @throws Error if the search text is not found in the example code.
 */
function findLineInExampleCode({
  searchText,
  example = bracket,
}: {
  searchText: string
  example?: string
}) {
  const lines = example.split('\n')
  const lineNumber = lines.findIndex((l) => l.includes(searchText)) + 1
  if (lineNumber === 0) {
    // We are exporting a constant, so we don't want to return an Error.
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new Error(
      `Could not find the line with search text "${searchText}" in the example code. Was it removed?`
    )
  }
  return lineNumber
}
export const bracketWidthConstantLine = findLineInExampleCode({
  searchText: 'width =',
})
export const bracketThicknessCalculationLine = findLineInExampleCode({
  searchText: 'thickness =',
})
