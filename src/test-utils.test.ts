import { normaliseKclNumbers } from '../e2e/playwright/test-utils'

test('normaliseKclNumbers', () => {
  expect(
    normaliseKclNumbers(`sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
const extrude001 = extrude(sketch001, length = -15)`)
  ).toBe(`sketch001 = startSketchOn('XY')
  |> startProfileAt([-12.34, 12.34], %)
  |> line(end = [12.34, 0])
  |> line(end = [0, -12.34])
  |> line(end = [-12.34, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
const extrude001 = extrude(sketch001, length = -12.34)`)
  expect(
    normaliseKclNumbers(
      `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
const extrude001 = extrude(sketch001, length = -15)`,
      false
    )
  ).toBe(`sketch001 = startSketchOn('XY')
  |> startProfileAt([-12.34, 12.34], %)
  |> line(end = [12.34, 12.34])
  |> line(end = [12.34, -12.34])
  |> line(end = [-12.34, 12.34])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
const extrude001 = extrude(sketch001, length = -12.34)`)
})
