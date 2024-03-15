export const bracket = `// Mounting Plate
// A flat piece of material, often metal or plastic, that serves as a support or base for attaching, securing, or mounting various types of equipment, devices, or components.

// Create a function that defines the body width and length of the mounting plate. Tag the corners so they can be passed through the fillet function.
fn rectShape = (pos, w, l) => {
  const rr = startSketchOn('XY')
  |> startProfileAt([pos[0] - (w / 2), pos[1] - (l / 2)], %)
  |> lineTo([pos[0] + w / 2, pos[1] - (l / 2)], %, 'edge1')
  |> lineTo([pos[0] + w / 2, pos[1] + l / 2], %, 'edge2')
  |> lineTo([pos[0] - (w / 2), pos[1] + l / 2], %, 'edge3')
  |> close(%, "edge4")
  return rr
}

// Define the hole radius and x, y location constants
const holeRadius = 1
const holeIndex = 6

// Create the mounting plate extrusion, holes, and fillets
const part = rectShape([0, 0], 20, 20)
  |> hole(circle([-holeIndex, holeIndex], holeRadius, %), %)
  |> hole(circle([holeIndex, holeIndex], holeRadius, %), %)
  |> hole(circle([-holeIndex, -holeIndex], holeRadius, %), %)
  |> hole(circle([holeIndex, -holeIndex], holeRadius, %), %)
  |> extrude(2, %)
  |> fillet({
       radius: 4,
       tags: [
  getNextAdjacentEdge("edge1", %),
  getNextAdjacentEdge("edge2", %),
  getNextAdjacentEdge("edge3", %),
  getNextAdjacentEdge("edge4", %)
]
     }, %)

`
