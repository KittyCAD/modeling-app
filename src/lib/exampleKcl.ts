export const bracket = `// Shelf Bracket
// This is a bracket that holds a shelf. It is made of aluminum and is designed to hold a force of 300 lbs. The bracket is 6 inches wide and the force is applied at the end of the shelf, 12 inches from the wall. The bracket has a factor of safety of 1.2. The legs of the bracket are 5 inches and 2 inches long. The thickness of the bracket is calculated from the constraints provided.

// Define constants
const sigmaAllow = 35000 // psi (6061-T6 aluminum)
const width = 6 // inch
const p = 300 // Force on shelf - lbs
const factorOfSafety = 1.2 // FOS of 1.2
const shelfMountL = 5 // inches
const wallMountL = 2 // inches
const shelfDepth = 12 // Shelf is 12 inches in depth from the wall
const moment = shelfDepth * p // assume the force is applied at the end of the shelf to be conservative (lb-in)

const filletRadius = .375 // inches
const extFilletRadius = .25 // inches
const mountingHoleDiameter = 0.5 // inches

// Calculate required thickness of bracket
const thickness = sqrt(moment * factorOfSafety * 6 / (sigmaAllow * width)) // this is the calculation of two brackets holding up the shelf (inches)

// Sketch the bracket body and fillet the inner and outer edges of the bend
const bracketLeg1Sketch = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([shelfMountL-filletRadius, 0], %, $fillet1)
  |> line([0, width], %, $fillet2)
  |> line([-shelfMountL + filletRadius, 0], %)
  |> close(%)
  |> hole(circle([1, 1], mountingHoleDiameter/2, %), %)
  |> hole(circle([shelfMountL-1.5, width-1], mountingHoleDiameter/2, %), %)
  |> hole(circle([1, width-1], mountingHoleDiameter/2, %), %)
  |> hole(circle([shelfMountL-1.5, 1], mountingHoleDiameter/2, %), %)

// Extrude the leg 2 bracket sketch
const bracketLeg1Extrude = extrude(thickness, bracketLeg1Sketch)
  |> fillet({
    radius: extFilletRadius,
    tags: [
      getNextAdjacentEdge(fillet1),
      getNextAdjacentEdge(fillet2)
    ],
  }, %)

// Sketch the fillet arc
const filletSketch = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> line([0, thickness], %)
  |> arc({
    angleEnd: 180,
    angleStart: 90,
    radius: filletRadius + thickness,
  }, %)
  |> line([thickness, 0], %)
  |> arc({
    angleEnd: 90,
    angleStart: 180,
    radius: filletRadius,
  }, %)

// Sketch the bend
const filletExtrude = extrude(-width, filletSketch)

// Create a custom plane for the leg that sits on the wall
const customPlane = {
  plane: {
    origin: { x: -filletRadius, y: 0, z: 0 },
    xAxis: { x: 0, y: 1, z: 0 },
    yAxis: { x: 0, y: 0, z: 1 },
    zAxis: { x: 1, y: 0, z: 0 }
  }
}

// Create a sketch for the second leg
const bracketLeg2Sketch = startSketchOn(customPlane)
  |> startProfileAt([0, -filletRadius], %)
  |> line([width, 0], %)
  |> line([0, -wallMountL], %, $fillet3)
  |> line([-width, 0], %, $fillet4)
  |> close(%)
  |> hole(circle([1, -1.5], mountingHoleDiameter / 2, %), %)
  |> hole(circle([5, -1.5], mountingHoleDiameter / 2, %), %)

// Extrude the second leg
const bracketLeg2Extrude = extrude(-thickness, bracketLeg2Sketch)
  |> fillet({
    radius: extFilletRadius,
    tags: [
      getNextAdjacentEdge(fillet3),
      getNextAdjacentEdge(fillet4)
    ],
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
