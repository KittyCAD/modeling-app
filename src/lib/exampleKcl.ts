export const bracket = `const thickness = 0.9
const filletR = thickness * 1.8
const shelfMountL = 4
const wallMountL = 12
const width = 7

const bracket = startSketchAt([0, 0])
  |> line([0, wallMountL], %)
  |> tangentalArc({
    radius: filletR,
    offset: 90
  }, %)
  |> line([-shelfMountL, 0], %)
  |> line([0, -thickness], %)
  |> line([shelfMountL, 0], %)
  |> tangentalArc({
    radius: filletR - thickness,
    offset: -90
  }, %)
  |> line([0, -wallMountL], %)
  |> close(%)
  |> extrude(width, %)

show(bracket)
`
