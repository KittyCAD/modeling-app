import bracket from '@public/kcl-samples/bracket/main.kcl?raw'
import fanAssembly from '@public/kcl-samples/axial-fan/main.kcl?raw'
import fanHousingOriginal from '@public/kcl-samples/axial-fan/fan-housing.kcl?raw'
import fanFan from '@public/kcl-samples/axial-fan/fan.kcl?raw'
import fanMotor from '@public/kcl-samples/axial-fan/motor.kcl?raw'
import fanParameters from '@public/kcl-samples/axial-fan/parameters.kcl?raw'

export { bracket }
export const fanParts = [
  { requestedFileName: 'main.kcl', requestedCode: fanAssembly },
  { requestedFileName: 'fan.kcl', requestedCode: fanFan },
  { requestedFileName: 'motor.kcl', requestedCode: fanMotor },
  { requestedFileName: 'parameters.kcl', requestedCode: fanParameters },
  { requestedFileName: 'fan-housing.kcl', requestedCode: fanHousingOriginal },
] as const

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

const fanHousing = `
// Fan Housing
// The plastic housing that contains the fan and the motor

// Set units
@settings(defaultLengthUnit = mm)

// Define Parameters
export fanSize = 120
export fanHeight = 25
export mountingHoleSpacing = 105
export mountingHoleSize = 4.5

// Model the housing which holds the motor, the fan, and the mounting provisions
// Bottom mounting face
bottomFaceSketch = startSketchOn(XY)
  |> startProfile(at = [-fanSize / 2, -fanSize / 2])
  |> angledLine(angle = 0, length = fanSize, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) + 90, length = fanSize, tag = $rectangleSegmentB001)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $rectangleSegmentC001)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $rectangleSegmentD001)
  |> close()
  |> subtract2d(tool = circle(center = [0, 0], radius = 4))
  |> subtract2d(tool = circle(
       center = [
         mountingHoleSpacing / 2,
         mountingHoleSpacing / 2
       ],
       radius = mountingHoleSize / 2,
     ))
  |> subtract2d(tool = circle(
       center = [
         -mountingHoleSpacing / 2,
         mountingHoleSpacing / 2
       ],
       radius = mountingHoleSize / 2,
     ))
  |> subtract2d(tool = circle(
       center = [
         mountingHoleSpacing / 2,
         -mountingHoleSpacing / 2
       ],
       radius = mountingHoleSize / 2,
     ))
  |> subtract2d(tool = circle(
       center = [
         -mountingHoleSpacing / 2,
         -mountingHoleSpacing / 2
       ],
       radius = mountingHoleSize / 2,
     ))
  |> extrude(length = 4)

// Add large openings to the bottom face to allow airflow through the fan
airflowPattern = startSketchOn(bottomFaceSketch, face = END)
  |> startProfile(at = [fanSize * 7 / 25, -fanSize * 9 / 25])
  |> angledLine(angle = 140, length = fanSize * 12 / 25, tag = $seg01)
  |> tangentialArc(radius = fanSize * 1 / 50, angle = 90)
  |> angledLine(angle = -130, length = fanSize * 8 / 25)
  |> tangentialArc(radius = fanSize * 1 / 50, angle = 90)
  |> angledLine(angle = segAng(seg01) + 180, length = fanSize * 2 / 25)
  |> tangentialArc(radius = fanSize * 8 / 25, angle = 40)
  |> xLine(length = fanSize * 3 / 25)
  |> tangentialArc(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  |> patternCircular2d(
       instances = 4,
       center = [0, 0],
       arcDegrees = 360,
       rotateDuplicates = true,
     )
  |> extrude(length = -4)

// Create the middle segment of the fan housing body
housingMiddleLength = fanSize / 3
housingMiddleRadius = fanSize / 3 - 1
bodyMiddle = startSketchOn(bottomFaceSketch, face = END)
  |> startProfile(at = [
       housingMiddleLength / 2,
       -housingMiddleLength / 2 - housingMiddleRadius
     ])
  |> tangentialArc(radius = housingMiddleRadius, angle = 90)
  |> yLine(length = housingMiddleLength)
  |> tangentialArc(radius = housingMiddleRadius, angle = 90)
  |> xLine(length = -housingMiddleLength)
  |> tangentialArc(radius = housingMiddleRadius, angle = 90)
  |> yLine(length = -housingMiddleLength)
  |> tangentialArc(radius = housingMiddleRadius, angle = 90)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> extrude(length = fanHeight - 4 - 4)

// Cut a hole in the body to accommodate the fan
bodyFanHole = startSketchOn(bodyMiddle, face = END)
  |> circle(center = [0, 0], radius = fanSize * 23 / 50)
  |> extrude(length = -(fanHeight - 4 - 4))

// Top mounting face. Cut a hole in the face to accommodate the fan
topFaceSketch = startSketchOn(bodyMiddle, face = END)
topHoles = startProfile(topFaceSketch, at = [-fanSize / 2, -fanSize / 2])
  |> angledLine(angle = 0, length = fanSize, tag = $rectangleSegmentA002)
  |> angledLine(angle = segAng(rectangleSegmentA002) + 90, length = fanSize, tag = $rectangleSegmentB002)
  |> angledLine(angle = segAng(rectangleSegmentA002), length = -segLen(rectangleSegmentA002), tag = $rectangleSegmentC002)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $rectangleSegmentD002)
  |> close()
  |> subtract2d(tool = circle(center = [0, 0], radius = fanSize * 23 / 50))
  |> subtract2d(tool = circle(
       center = [
         mountingHoleSpacing / 2,
         mountingHoleSpacing / 2
       ],
       radius = mountingHoleSize / 2,
     ))
  |> subtract2d(tool = circle(
       center = [
         -mountingHoleSpacing / 2,
         mountingHoleSpacing / 2
       ],
       radius = mountingHoleSize / 2,
     ))
  |> subtract2d(tool = circle(
       center = [
         mountingHoleSpacing / 2,
         -mountingHoleSpacing / 2
       ],
       radius = mountingHoleSize / 2,
     ))
  |> subtract2d(tool = circle(
       center = [
         -mountingHoleSpacing / 2,
         -mountingHoleSpacing / 2
       ],
       radius = mountingHoleSize / 2,
     ))
  |> extrude(length = 4)

// Create a housing for the electric motor to sit
motorHousing = startSketchOn(bottomFaceSketch, face = END)
  |> circle(center = [0, 0], radius = 11.2)
  |> extrude(length = 16)

startSketchOn(motorHousing, face = END)
  |> circle(center = [0, 0], radius = 10)
  |> extrude(length = -16)
  |> appearance(color = "#a55e2c")
  |> fillet(
       radius = abs(fanSize - mountingHoleSpacing) / 2,
       tags = [
         getNextAdjacentEdge(rectangleSegmentA001),
         getNextAdjacentEdge(rectangleSegmentB001),
         getNextAdjacentEdge(rectangleSegmentC001),
         getNextAdjacentEdge(rectangleSegmentD001),
         getNextAdjacentEdge(rectangleSegmentA002),
         getNextAdjacentEdge(rectangleSegmentB002),
         getNextAdjacentEdge(rectangleSegmentC002),
         getNextAdjacentEdge(rectangleSegmentD002)
       ],
     )
`

export const modifiedFanHousing = `// Fan Housing
// The plastic housing that contains the fan and the motor

// Set units
@settings(defaultLengthUnit = mm)

export fanSize = 150
export fanHeight = 30
export mountingHoleSpacing = 105
export mountingHoleSize = 4.5

// Model the housing which holds the motor, the fan, and the mounting provisions
// Bottom mounting face
bottomFaceSketch = startSketchOn(XY)
  |> startProfile(at = [-fanSize / 2, -fanSize / 2])
  |> angledLine(angle = 0, length = fanSize, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) + 90, length = fanSize, tag = $rectangleSegmentB001)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $rectangleSegmentC001)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $rectangleSegmentD001)
  |> close()
  |> subtract2d(tool = circle(center = [0, 0], radius = 4))
  |> subtract2d(tool = circle(
       center = [
         mountingHoleSpacing / 2,
         mountingHoleSpacing / 2
       ],
       radius = mountingHoleSize / 2,
     ))
  |> subtract2d(tool = circle(
       center = [
         -mountingHoleSpacing / 2,
         mountingHoleSpacing / 2
       ],
       radius = mountingHoleSize / 2,
     ))
  |> subtract2d(tool = circle(
       center = [
         mountingHoleSpacing / 2,
         -mountingHoleSpacing / 2
       ],
       radius = mountingHoleSize / 2,
     ))
  |> subtract2d(tool = circle(
       center = [
         -mountingHoleSpacing / 2,
         -mountingHoleSpacing / 2
       ],
       radius = mountingHoleSize / 2,
     ))
  |> extrude(length = 4)

// Add large openings to the bottom face to allow airflow through the fan
airflowPattern = startSketchOn(bottomFaceSketch, face = END)
  |> startProfile(at = [fanSize * 7 / 25, -fanSize * 9 / 25])
  |> angledLine(angle = 140, length = fanSize * 12 / 25, tag = $seg01)
  |> tangentialArc(radius = fanSize * 1 / 50, angle = 90)
  |> angledLine(angle = -130, length = fanSize * 8 / 25)
  |> tangentialArc(radius = fanSize * 1 / 50, angle = 90)
  |> angledLine(angle = segAng(seg01) + 180, length = fanSize * 2 / 25)
  |> tangentialArc(radius = fanSize * 8 / 25, angle = 40)
  |> xLine(length = fanSize * 3 / 25)
  |> tangentialArc(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  |> patternCircular2d(
       instances = 4,
       center = [0, 0],
       arcDegrees = 360,
       rotateDuplicates = true,
     )
  |> extrude(length = -4)

// Create the middle segment of the fan housing body
housingMiddleLength = fanSize / 3
housingMiddleRadius = fanSize / 3 - 1
bodyMiddle = startSketchOn(bottomFaceSketch, face = END)
  |> startProfile(at = [
       housingMiddleLength / 2,
       -housingMiddleLength / 2 - housingMiddleRadius
     ])
  |> tangentialArc(radius = housingMiddleRadius, angle = 90)
  |> yLine(length = housingMiddleLength)
  |> tangentialArc(radius = housingMiddleRadius, angle = 90)
  |> xLine(length = -housingMiddleLength)
  |> tangentialArc(radius = housingMiddleRadius, angle = 90)
  |> yLine(length = -housingMiddleLength)
  |> tangentialArc(radius = housingMiddleRadius, angle = 90)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> extrude(length = fanHeight - 4 - 4)

// Cut a hole in the body to accommodate the fan
bodyFanHole = startSketchOn(bodyMiddle, face = END)
  |> circle(center = [0, 0], radius = fanSize * 23 / 50)
  |> extrude(length = -(fanHeight - 4 - 4))

// Top mounting face. Cut a hole in the face to accommodate the fan
topFaceSketch = startSketchOn(bodyMiddle, face = END)
topHoles = startProfile(topFaceSketch, at = [-fanSize / 2, -fanSize / 2])
  |> angledLine(angle = 0, length = fanSize, tag = $rectangleSegmentA002)
  |> angledLine(angle = segAng(rectangleSegmentA002) + 90, length = fanSize, tag = $rectangleSegmentB002)
  |> angledLine(angle = segAng(rectangleSegmentA002), length = -segLen(rectangleSegmentA002), tag = $rectangleSegmentC002)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $rectangleSegmentD002)
  |> close()
  |> subtract2d(tool = circle(center = [0, 0], radius = fanSize * 23 / 50))
  |> subtract2d(tool = circle(
       center = [
         mountingHoleSpacing / 2,
         mountingHoleSpacing / 2
       ],
       radius = mountingHoleSize / 2,
     ))
  |> subtract2d(tool = circle(
       center = [
         -mountingHoleSpacing / 2,
         mountingHoleSpacing / 2
       ],
       radius = mountingHoleSize / 2,
     ))
  |> subtract2d(tool = circle(
       center = [
         mountingHoleSpacing / 2,
         -mountingHoleSpacing / 2
       ],
       radius = mountingHoleSize / 2,
     ))
  |> subtract2d(tool = circle(
       center = [
         -mountingHoleSpacing / 2,
         -mountingHoleSpacing / 2
       ],
       radius = mountingHoleSize / 2,
     ))
  |> extrude(length = 4)

// Create a housing for the electric motor to sit
motorHousing = startSketchOn(bottomFaceSketch, face = END)
  |> circle(center = [0, 0], radius = 11.2)
  |> extrude(length = 16)

startSketchOn(motorHousing, face = END)
  |> circle(center = [0, 0], radius = 10)
  |> extrude(length = -16)
  |> appearance(color = "#800080") // Changed color to purple
  |> fillet(
       radius = abs(fanSize - mountingHoleSpacing) / 2,
       tags = [
         getNextAdjacentEdge(rectangleSegmentA001),
         getNextAdjacentEdge(rectangleSegmentB001),
         getNextAdjacentEdge(rectangleSegmentC001),
         getNextAdjacentEdge(rectangleSegmentD001),
         getNextAdjacentEdge(rectangleSegmentA002),
         getNextAdjacentEdge(rectangleSegmentB002),
         getNextAdjacentEdge(rectangleSegmentC002),
         getNextAdjacentEdge(rectangleSegmentD002)
       ],
     )
`

/**
 * GOTCHA: this browser sample is a reconstructed assembly, made by
 * concatenating the individual parts together. If the original axial-fan
 * KCL sample is updated, it can lead to breaking this export.
 */
export const browserAxialFan = `
${fanHousing}

// Fan
// Spinning axial fan that moves airflow

// Model the center of the fan
fanCenter = startSketchOn(XZ)
  |> startProfile(at = [-0.0001, fanHeight])
  |> xLine(endAbsolute = -15 + 1.5)
  |> tangentialArc(radius = 1.5, angle = 90)
  |> yLine(endAbsolute = 4.5)
  |> xLine(endAbsolute = -13)
  |> yLine(endAbsolute = profileStartY(%) - 5)
  |> tangentialArc(radius = 1, angle = -90)
  |> xLine(endAbsolute = -1)
  |> yLine(length = 2)
  |> xLine(length = -0.15)
  |> line(endAbsolute = [
       profileStartX(%) - 1,
       profileStartY(%) - 1.4
     ])
  |> xLine(endAbsolute = profileStartX(%))
  |> yLine(endAbsolute = profileStartY(%))
  |> close()
  |> revolve(axis = {
       direction = [0.0, 1.0],
       origin = [0.0, 0.0]
     })
  |> appearance(color = "#f3e2d8")

// Create a function for a lofted fan blade cross section that rotates about the center hub of the fan
fn fanBlade(offsetHeight, startAngle: number(deg)) {
  fanBlade = startSketchOn(offsetPlane(XY, offset = offsetHeight))
    |> startProfile(at = [
         15 * cos(startAngle),
         15 * sin(startAngle)
       ])
    |> arc(angleStart = startAngle, angleEnd = startAngle + 14, radius = 15)
    |> arc(
         endAbsolute = [
           fanSize * 22 / 50 * cos(startAngle - 20),
           fanSize * 22 / 50 * sin(startAngle - 20)
         ],
         interiorAbsolute = [
           fanSize * 11 / 50 * cos(startAngle + 3),
           fanSize * 11 / 50 * sin(startAngle + 3)
         ],
       )
    |> arc(
         endAbsolute = [
           fanSize * 22 / 50 * cos(startAngle - 24),
           fanSize * 22 / 50 * sin(startAngle - 24)
         ],
         interiorAbsolute = [
           fanSize * 22 / 50 * cos(startAngle - 22),
           fanSize * 22 / 50 * sin(startAngle - 22)
         ],
       )
    |> arc(
         endAbsolute = [profileStartX(%), profileStartY(%)],
         interiorAbsolute = [
           fanSize * 11 / 50 * cos(startAngle - 5),
           fanSize * 11 / 50 * sin(startAngle - 5)
         ],
       )
    |> close()
  return fanBlade
}

// Loft the fan blade cross sections into a single blade, then pattern them about the fan center
crossSections = [
  fanBlade(offsetHeight = 4.5, startAngle = 50),
  fanBlade(offsetHeight = (fanHeight - 2 - 4) / 2, startAngle = 30),
  fanBlade(offsetHeight = fanHeight - 2, startAngle = 0)
]
loft(crossSections)
  |> appearance(color = "#f3e2d8")
  |> patternCircular3d(
       instances = 9,
       axis = [0, 0, 1],
       center = [0, 0, 0],
       arcDegrees = 360,
       rotateDuplicates = true,
     )

// Motor
// A small electric motor to power the fan

// Model the motor body and stem
topFacePlane = offsetPlane(XY, offset = 4)
motorBody = startSketchOn(topFacePlane)
  |> circle(center = [0, 0], radius = 10, tag = $seg04)
  |> extrude(length = 17)
  |> appearance(color = "#021b55")
  |> fillet(radius = 2, tags = [getOppositeEdge(seg04), seg04])
startSketchOn(offsetPlane(XY, offset = 21))
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 3.8)
  |> appearance(color = "#dbc89e")
`

/**
 * GOTCHA: this browser sample is a reconstructed assembly, made by
 * concatenating the individual parts together. If the original axial-fan
 * KCL sample is updated, it can lead to breaking this export.
 */
export const browserAxialFanAfterTextToCad = `
${modifiedFanHousing}

// Fan
// Spinning axial fan that moves airflow

// Model the center of the fan
fanCenter = startSketchOn(XZ)
  |> startProfile(at = [-0.0001, fanHeight])
  |> xLine(endAbsolute = -15 + 1.5)
  |> tangentialArc(radius = 1.5, angle = 90)
  |> yLine(endAbsolute = 4.5)
  |> xLine(endAbsolute = -13)
  |> yLine(endAbsolute = profileStartY(%) - 5)
  |> tangentialArc(radius = 1, angle = -90)
  |> xLine(endAbsolute = -1)
  |> yLine(length = 2)
  |> xLine(length = -0.15)
  |> line(endAbsolute = [
       profileStartX(%) - 1,
       profileStartY(%) - 1.4
     ])
  |> xLine(endAbsolute = profileStartX(%))
  |> yLine(endAbsolute = profileStartY(%))
  |> close()
  |> revolve(axis = {
       direction = [0.0, 1.0],
       origin = [0.0, 0.0]
     })
  |> appearance(color = "#f3e2d8")

// Create a function for a lofted fan blade cross section that rotates about the center hub of the fan
fn fanBlade(offsetHeight, startAngle: number(deg)) {
  fanBlade = startSketchOn(offsetPlane(XY, offset = offsetHeight))
    |> startProfile(at = [
         15 * cos(startAngle),
         15 * sin(startAngle)
       ])
    |> arc(angleStart = startAngle, angleEnd = startAngle + 14, radius = 15)
    |> arc(
         endAbsolute = [
           fanSize * 22 / 50 * cos(startAngle - 20),
           fanSize * 22 / 50 * sin(startAngle - 20)
         ],
         interiorAbsolute = [
           fanSize * 11 / 50 * cos(startAngle + 3),
           fanSize * 11 / 50 * sin(startAngle + 3)
         ],
       )
    |> arc(
         endAbsolute = [
           fanSize * 22 / 50 * cos(startAngle - 24),
           fanSize * 22 / 50 * sin(startAngle - 24)
         ],
         interiorAbsolute = [
           fanSize * 22 / 50 * cos(startAngle - 22),
           fanSize * 22 / 50 * sin(startAngle - 22)
         ],
       )
    |> arc(
         endAbsolute = [profileStartX(%), profileStartY(%)],
         interiorAbsolute = [
           fanSize * 11 / 50 * cos(startAngle - 5),
           fanSize * 11 / 50 * sin(startAngle - 5)
         ],
       )
    |> close()
  return fanBlade
}

// Loft the fan blade cross sections into a single blade, then pattern them about the fan center
crossSections = [
  fanBlade(offsetHeight = 4.5, startAngle = 50),
  fanBlade(offsetHeight = (fanHeight - 2 - 4) / 2, startAngle = 30),
  fanBlade(offsetHeight = fanHeight - 2, startAngle = 0)
]
loft(crossSections)
  |> appearance(color = "#f3e2d8")
  |> patternCircular3d(
       instances = 9,
       axis = [0, 0, 1],
       center = [0, 0, 0],
       arcDegrees = 360,
       rotateDuplicates = true,
     )

// Motor
// A small electric motor to power the fan

// Model the motor body and stem
topFacePlane = offsetPlane(XY, offset = 4)
motorBody = startSketchOn(topFacePlane)
  |> circle(center = [0, 0], radius = 10, tag = $seg04)
  |> extrude(length = 17)
  |> appearance(color = "#021b55")
  |> fillet(radius = 2, tags = [getOppositeEdge(seg04), seg04])
startSketchOn(offsetPlane(XY, offset = 21))
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 3.8)
  |> appearance(color = "#dbc89e")
`
