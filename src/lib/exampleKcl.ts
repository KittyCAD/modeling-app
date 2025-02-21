export const bracket = `// Shelf Bracket
// This is a bracket that holds a shelf. It is made of aluminum and is designed to hold a force of 300 lbs. The bracket is 6 inches wide and the force is applied at the end of the shelf, 12 inches from the wall. The bracket has a factor of safety of 1.2. The legs of the bracket are 5 inches and 2 inches long. The thickness of the bracket is calculated from the constraints provided.


// Define constants
sigmaAllow = 35000 // psi (6061-T6 aluminum)
width = 6 // inch
p = 300 // Force on shelf - lbs
factorOfSafety = 1.2 // FOS of 1.2
shelfMountL = 5 // inches
wallMountL = 2 // inches
shelfDepth = 12 // Shelf is 12 inches in depth from the wall
moment = shelfDepth * p // assume the force is applied at the end of the shelf to be conservative (lb-in)

// Calculate required thickness of bracket
thickness = sqrt(moment * factorOfSafety * 6 / (sigmaAllow * width)) // this is the calculation of two brackets holding up the shelf (inches)

filletRadius = .25
extFilletRadius = filletRadius + thickness
mountingHoleDiameter = 0.5

sketch001 = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> xLine(shelfMountL - thickness, %, $seg01)
  |> yLine(thickness, %, $seg02)
  |> xLine(-shelfMountL, %, $seg03)
  |> yLine(-wallMountL, %, $seg04)
  |> xLine(thickness, %, $seg05)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg06)
  |> close()
  |> extrude(%, length = width)
  |> fillet({
       radius = extFilletRadius,
       tags = [getNextAdjacentEdge(seg03)]
     }, %)
  |> fillet({
       radius = filletRadius,
       tags = [getNextAdjacentEdge(seg06)]
     }, %)
  |> fillet({
    radius = filletRadius,
    tags = [seg02, getOppositeEdge(seg02)],
  }, %)
  |> fillet({
    radius = filletRadius,
    tags = [seg05, getOppositeEdge(seg05)],
  }, %)

sketch002 = startSketchOn(sketch001, seg03)
  |> circle({
    center = [-1.25, 1],
    radius = mountingHoleDiameter / 2,
  }, %)
  |> patternLinear2d(
    instances = 2,
    distance = 2.5,
    axis = [-1, 0],
  )
  |> patternLinear2d(
    instances = 2,
    distance = 4,
    axis = [0, 1],
  )
  |> extrude(%, length = -thickness-.01)

sketch003 = startSketchOn(sketch001, seg04)
  |> circle({
    center = [1, -1],
    radius = mountingHoleDiameter / 2,
  }, %)
  |> patternLinear2d(
    instances = 2,
    distance = 4,
    axis = [1, 0],
  )
  |> extrude(%, length = -thickness-0.1)
`

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
