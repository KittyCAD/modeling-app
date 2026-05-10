export const OPEN_CASCADE_CIRCLE_EXTRUDE_KCL = `sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 0.89mm, var 0.72mm], center = [var 0mm, var 0mm])
  coincident([circle1.center, ORIGIN])
}
hidden001 = hide(sketch001)
region001 = region(point = [-0.8880564mm, -0.7184276mm], sketch = sketch001)
extrude001 = extrude(region001, length = 5)
`
