export const bracket = `// Material: 6061-T6 Aluminum

const sigmaAllow = 35000 // psi
const width = 4 // inch

const p = 150 // Force on shelf - lbs
const distance = 6 // inches
const FOS = 2

const leg1 = 5 // inches
const leg2 = 8 // inches

const thickness_squared = distance * p * FOS * 6 / sigmaAllow / width
const thickness = 0.32 // inches. App does not support square root function yet

const bracket = startSketchAt([0,0])
  |> line([0, leg1], %)
  |> line([leg2, 0], %)
  |> line([0, -thickness], %)
  |> line([-1 * leg2 + thickness, 0], %)
  |> line([0, -1 * leg1 + thickness], %)
  |> close(%)
  |> extrude(width, %)

show(bracket)
`
