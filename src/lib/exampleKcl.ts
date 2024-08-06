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
       tags: [getPreviousAdjacentEdge(innerEdge)]
     }, %)
  |> fillet({
       radius: filletR + thickness,
       tags: [getPreviousAdjacentEdge(outerEdge)]
     }, %)`

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

export const gear = `// Gear
// A rotating machine part having cut teeth or, in the case of a cogwheel, inserted teeth (called cogs), which mesh with another toothed part to transmit torque. Geared devices can change the speed, torque, and direction of a power source. The two elements that define a gear are its circular shape and the teeth that are integrated into its outer edge, which are designed to fit into the teeth of another gear.

// Define constants
const gearWidth = 3
const gearScale = 20
const toothScale = gearScale / 5
const boreDiameter = 9
const teethNumber = 14

// Create the body of the gear with the hole in the center
const body = startSketchOn('XY')
  |> circle([0, 0], gearScale, %)
  |> hole(circle([0, 0], boreDiameter, %), %)
  |> extrude(gearWidth, %)

// Define the function for a single tooth
fn tooth = (toothSize) => {
  const singleTooth = startSketchOn('XY')
  |> startProfileAt([
       0.0000000000 * toothSize,
       5.0000000000 * toothSize
     ], %)
  |> line([
       0.4900857016 * toothSize,
       -0.0240763666 * toothSize
     ], %)
  |> line([
       0.6804562304 * toothSize,
       0.9087880491 * toothSize
     ], %)
  |> line([
       0.5711661314 * toothSize,
       -0.1430696680 * toothSize
     ], %)
  |> line([
       0.1717090983 * toothSize,
       -1.1222443518 * toothSize
     ], %)
  |> line([
       0.4435665223 * toothSize,
       -0.2097913408 * toothSize
     ], %)
  |> close(%)
  |> extrude(gearWidth, %)
  return singleTooth
}

// Extrude the first tooth and pattern around the z-axis
const allGearTeeth = tooth(toothScale)
  |> patternCircular3d({
       arcDegrees: 360,
       axis: [0, 0, 1],
       center: [0, 0, 0],
       repetitions: teethNumber,
       rotateDuplicates: true
     }, %)`
