import { assertParse } from '@src/lang/wasm'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { describe, it } from 'vitest'

const subtractPatternedSolids = `@settings(experimentalFeatures = allow)

sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 42.89mm, var 40.01mm], center = [var 0mm, var 0mm])
  coincident([circle1.center, ORIGIN])
  line1 = line(start = [var 105.93mm, var -82.57mm], end = [var 226.02mm, var -82.57mm])
  line2 = line(start = [var 226.02mm, var -82.57mm], end = [var 226.02mm, var 63.25mm])
  line3 = line(start = [var 226.02mm, var 63.25mm], end = [var 105.93mm, var 63.25mm])
  line4 = line(start = [var 105.93mm, var 63.25mm], end = [var 105.93mm, var -82.57mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
}
hidden001 = hide(sketch001)
region001 = region(point = [175.335mm, 22.565mm], sketch = sketch001)
extrude001 = extrude(region001, length = 15)
pattern001 = patternCircular3d(
  extrude001,
  instances = 3,
  axis = Z,
  center = [0, 0, 0],
)
sketch002 = sketch(on = XZ) {
  line1 = line(start = [var -41.3mm, var 52.9mm], end = [var -94.34mm, var 36.56mm])
  line2 = line(start = [var -94.34mm, var 36.56mm], end = [var -92.33mm, var 23.94mm])
  coincident([line1.end, line2.start])
  line3 = line(start = [var -92.33mm, var 23.94mm], end = [var -109.44mm, var -6.08mm])
  coincident([line3.start, line2.end])
  line4 = line(start = [var -109.44mm, var -6.08mm], end = [var -105.74mm, var -15.06mm])
  coincident([line3.end, line4.start])
  line5 = line(start = [var -41.3mm, var 52.9mm], end = [var -105.74mm, var -15.06mm])
  coincident([line5.start, line1.start])
  coincident([line5.end, line4.end])
}
hidden002 = hide(sketch002)
region002 = region(point = [-81.0919282mm, 23.2709942mm], sketch = sketch002)
revolve001 = revolve(region002, angle = 360deg, axis = Y)
union001 = subtract(
  revolve001,
  tools = [
    pattern001[0],
    pattern001[1],
    pattern001[2]
  ],
)`

describe('engine primitive edge validation', () => {
  it('mock validates fillets on solids built from indexed circular patterns', async () => {
    const { instance, rustContext, settingsActor } =
      await buildTheWorldAndNoEngineConnection()
    const ast = assertParse(
      `${subtractPatternedSolids}
edge001 = edgeId(union001, index = 0)
fillet001 = fillet(union001, tags = edge001, radius = 4)`,
      instance
    )

    await rustContext.executeMock(
      ast,
      jsAppSettings(settingsActor),
      undefined,
      false
    )
  })
})
