import { normaliseKclNumbers } from '../e2e/playwright/test-utils'

test('normaliseKclNumbers', () => {
  expect(
    normaliseKclNumbers(`sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %)
  |> line([0, -20], %)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude001 = extrude(-15, sketch001)`)
  ).toBe(`sketch001 = startSketchOn('XY')
  |> startProfileAt([-12.34, 12.34], %)
  |> line([12.34, 0], %)
  |> line([0, -12.34], %)
  |> line([-12.34, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude001 = extrude(-12.34, sketch001)`)
  expect(
    normaliseKclNumbers(
      `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %)
  |> line([0, -20], %)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude001 = extrude(-15, sketch001)`,
      false
    )
  ).toBe(`sketch001 = startSketchOn('XY')
  |> startProfileAt([-12.34, 12.34], %)
  |> line([12.34, 12.34], %)
  |> line([12.34, -12.34], %)
  |> line([-12.34, 12.34], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude001 = extrude(-12.34, sketch001)`)
})
