export const bracket = `// Shelf Bracket
// This is a shelf bracket made out of 6061-T6 aluminum sheet metal. The required thickness is calculated based on a point load of 300 lbs applied to the end of the shelf. There are two brackets holding up the shelf, so the moment experienced is divided by 2. The shelf is 1 foot long from the wall.

// Define our bracket feet lengths
const shelfMountL = 8 // The length of the bracket holding up the shelf is 6 inches
const wallMountL = 6 // the length of the bracket

// Define constants required to calculate the thickness needed to support 300 lbs
const sigmaAllow = 35000 // psi
const width = 6 // inch
const p = 300 // Force on shelf - lbs
const shelfLength = 12 // inches
const moment = shelfLength * p / 2 // Moment experienced at fixed end of bracket
const factorOfSafety = 2 // Factor of safety of 2 to be conservative

// Calculate the thickness off the bending stress and factor of safety
const thickness = sqrt(6 * moment * factorOfSafety / (width * sigmaAllow))

// 0.25 inch fillet radius
const filletR = 0.25

// Sketch the bracket and extrude with fillets
const bracket = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, wallMountL], %, $outerEdge)
  |> line([-shelfMountL, 0], %)
  |> line([0, -thickness], %)
  |> line([shelfMountL - thickness, 0], %, $innerEdge)
  |> line([0, -wallMountL + thickness], %)
  |> close(%)
  |> extrude(width, %)
  |> fillet({
       radius: filletR,
       tags: [getNextAdjacentEdge(innerEdge)]
     }, %)
  |> fillet({
       radius: filletR + thickness,
       tags: [getNextAdjacentEdge(outerEdge)]
     }, %)`

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
  searchText: 'const width',
})
export const bracketThicknessCalculationLine = findLineInExampleCode({
  searchText: 'const thickness',
})
