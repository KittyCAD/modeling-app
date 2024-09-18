import { test, expect } from './authenticatedAppFixture'

// test file is for testing point an click code gen functionality that's not sketch mode related

test('verify extruding circle works', async ({ app }) => {
  const file = await app.getInputFile('test-circle-extrude.kcl')
  await app.initialise(file)
  const [clickCircle, moveToCircle] = app.makeMouseHelpers(582, 217)

  await test.step('because there is sweepable geometry, verify extrude is enable when nothing is selected', async () => {
    await app.clickNoWhere()
    await app.expectExtrudeButtonToBeEnabled()
  })

  await test.step('check code model connection works and that button is still enable once circle is selected ', async () => {
    await moveToCircle()
    const circleSnippet =
      'circle({ center: [318.33, 168.1], radius: 182.8 }, %)'
    await app.expectCodeHighlightedToBe(circleSnippet)

    await clickCircle()
    await app.expectActiveLinesToBe([circleSnippet.slice(-5)])
    await app.expectExtrudeButtonToBeEnabled()
  })

  await test.step('do extrude flow and check extrude code is added to editor', async () => {
    await app.clickExtrudeButton()

    await expect
      .poll(() => app.serialiseCmdBar())
      .toEqual({
        currentArg: 'distance',
        tabNames: ['Selection: 1 face', 'Distance:'],
        currentTab: 'distance:',
        currentArgValue: '5',
        inReview: false,
      })
    await app.progressCmdBar()

    const expectString = 'const extrude001 = extrude(5, sketch001)'
    await app.expectEditor.not.toContain(expectString)

    await expect
      .poll(() => app.serialiseCmdBar())
      .toEqual({
        inReview: true,
        tabNames: ['Selection: 1 face', 'Distance: 5'],
        currentArg: '',
        currentTab: '',
        currentArgValue: '',
      })
    await app.progressCmdBar()

    await app.expectEditor.toContain(expectString)
  })
})
