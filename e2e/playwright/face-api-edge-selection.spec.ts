import { expect, test } from '@e2e/playwright/zoo-test'
import type { CmdBarSerialised } from '@e2e/playwright/fixtures/cmdBarFixture'

/**
 * Test KCL code - creates a scene with solid3d, surface, and split edges
 */
const testCode = `sketch001 = startSketchOn(YZ)
    profile001 = startProfile(sketch001, at = [-21.99, 8.01])
    |> angledLine(angle = 0deg, length = 8.96, tag = $rectangleSegmentA001)
    |> angledLine(angle = segAng(rectangleSegmentA001) - 90deg, length = 9.8)
    |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
    profile002 = startProfile(sketch001, at = [6.83, -2.24])
    |> line(end = [8.24, 12.65])
    |> line(end = [6.49, -12.52])
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
    profile003 = startProfile(sketch001, at = [6.11, -13.2])
    |> angledLine(angle = 0deg, length = 10.71, tag = $rectangleSegmentA002)
    |> angledLine(angle = segAng(rectangleSegmentA002) - 90deg, length = 9.54)
    |> angledLine(angle = segAng(rectangleSegmentA002), length = -segLen(rectangleSegmentA002))
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
    profile004 = circle(sketch001, center = [-1.16, -28.94], radius = 3.16)
    profile005 = circle(sketch001, center = [-7.82, 13.15], radius = 2.64)
    extrude001 = extrude(profile002, length = 15)
    extrude002 = extrude(profile003, length = 20, bodyType = SURFACE)
    sketch002 = startSketchOn(XZ)
    profile006 = startProfile(sketch002, at = [4.61, 11.1])
    |> line(end = [3.52, -1.94])
    |> line(end = [4.03, 1.84])
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
    extrude003 = extrude(profile006, length = -100)
    solid001 = subtract(extrude001, tools = extrude003)
`

/**
 * Tests for edge selection using the global index API.
 *
 * These tests verify that we can correctly select edges in different scenarios:
 * - Solid3D edges (from extrude001, solid001)
 * - Surface edges (from extrude002 with bodyType = SURFACE)
 * - Split edges (edges created by boolean operations like subtract)
 */
test.describe('Face API edge selection', { tag: '@web' }, () => {
  test('Can select Solid3D edges and Surface edges for revolve', async ({
    context,
    homePage,
    scene,
    cmdBar,
    page,
    toolbar,
    editor,
  }) => {
    await context.addInitScript((code) => {
      localStorage.setItem('persistCode', code)
    }, testCode)

    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    // Set camera so that we can select what we need to.
    await scene.moveCameraTo(
      { x: -25.47, y: -19, z: -11 },
      { x: -2.5, y: -3.7, z: -19.5 }
    )

    await test.step('First revolve: profile and edge using ratio clicks', async () => {
      const [clickProfile] = scene.makeMouseHelpers(0.49, 0.79, {
        format: 'ratio',
      })
      const [clickEdge, mv] = scene.makeMouseHelpers(0.1907, 0.3477, {
        format: 'ratio',
        steps: 5,
      })
      // Base state object that we'll mutate as we progress
      const state: CmdBarSerialised = {
        commandName: 'Revolve',
        currentArgKey: 'sketches',
        currentArgValue: '',
        headerArguments: {
          Profiles: '',
          AxisOrEdge: '',
          Angle: '',
        },
        highlightedHeaderArg: 'Profiles',
        stage: 'arguments',
      }

      await toolbar.revolveButton.click()
      await cmdBar.expectState(state as CmdBarSerialised)

      await clickProfile()

      // Update state after profile selection
      state.currentArgKey = 'axisOrEdge'
      state.headerArguments.Profiles = '1 profile'
      state.highlightedHeaderArg = 'axisOrEdge'
      await cmdBar.progressCmdBar()
      await cmdBar.expectState(state as CmdBarSerialised)

      // Select Edge option
      await cmdBar.selectOption({ name: 'Edge' }).click()
      state.currentArgKey = 'edge'
      state.headerArguments.AxisOrEdge = 'Edge'
      state.headerArguments.Edge = ''
      state.highlightedHeaderArg = 'edge'
      await cmdBar.expectState(state)

      // select edge
      await mv()
      await clickEdge()

      // Update state after edge selection
      state.currentArgKey = 'angle'
      state.currentArgValue = '360deg'
      state.headerArguments.Edge = '1 edge'
      state.highlightedHeaderArg = 'angle'
      await cmdBar.progressCmdBar()
      await cmdBar.expectState(state as CmdBarSerialised)

      // Move to review stage
      state.currentArgKey = ''
      state.currentArgValue = ''
      //   state.highlightedHeaderArg = undefined
      state.headerArguments.Angle = '360deg'
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        commandName: state.commandName,
        headerArguments: state.headerArguments,
        stage: 'review',
        reviewValidationError: undefined,
      })

      await cmdBar.submit()

      // Assert code contains revolve
      await editor.expectEditor.toContain('revolve')
    })

    await test.step('Second revolve: profile and edge using ratio clicks', async () => {
      const [clickProfile2] = scene.makeMouseHelpers(0.3343, 0.375, {
        format: 'ratio',
      })
      const [clickEdge2] = scene.makeMouseHelpers(0.6671, 0.6136, {
        format: 'ratio',
      })
      // Remove the first revolve so only one revolve remains in the code. Two revolves
      // in the same file currently trigger an order-dependent lint error; this step
      // still exercises edge selection for the second revolve. See order-dependent bug.
      // TODO this might get resolved soon so check if we can skip this step
      const codeAfterFirst = await editor.getCurrentCode()
      const start = codeAfterFirst.indexOf('revolve001 = revolve(')
      if (start !== -1) {
        let depth = 0
        let i = codeAfterFirst.indexOf('(', start)
        for (; i < codeAfterFirst.length; i++) {
          if (codeAfterFirst[i] === '(') depth++
          else if (codeAfterFirst[i] === ')') {
            depth--
            if (depth === 0) break
          }
        }
        const rest = codeAfterFirst.slice(i + 1).replace(/^\s*,?\s*\n?/, '')
        const codeWithoutFirst = codeAfterFirst.slice(0, start) + rest
        await editor.replaceCode('', codeWithoutFirst)
        await scene.settled(cmdBar)
      }

      // Set camera position for second revolve
      await scene.moveCameraTo(
        { x: -23.6, y: -21.18, z: 9.66 },
        { x: 11.16, y: -10.1, z: 10.71 }
      )

      // Base state object that we'll mutate as we progress
      const state: CmdBarSerialised = {
        commandName: 'Revolve',
        currentArgKey: 'sketches',
        currentArgValue: '',
        headerArguments: {
          Profiles: '',
          AxisOrEdge: '',
          Angle: '',
        },
        highlightedHeaderArg: 'Profiles',
        stage: 'arguments',
      }

      // Click revolve tool again
      await toolbar.revolveButton.click()
      await cmdBar.expectState(state)

      // Click profile using ratio clicks
      await clickProfile2()

      // Update state after profile selection
      state.currentArgKey = 'axisOrEdge'
      state.headerArguments.Profiles = '1 profile'
      state.highlightedHeaderArg = 'axisOrEdge'
      await cmdBar.progressCmdBar()
      await cmdBar.expectState(state as CmdBarSerialised)

      // Select Edge option
      await cmdBar.selectOption({ name: 'Edge' }).click()
      state.currentArgKey = 'edge'
      state.headerArguments.AxisOrEdge = 'Edge'
      state.headerArguments.Edge = ''
      state.highlightedHeaderArg = 'edge'
      await cmdBar.expectState(state)

      // Click edge using ratio clicks
      await clickEdge2()

      // Update state after edge selection
      state.currentArgKey = 'angle'
      state.currentArgValue = '360deg'
      state.headerArguments.Edge = '1 edge'
      state.highlightedHeaderArg = 'angle'
      await cmdBar.progressCmdBar()
      await cmdBar.expectState(state as CmdBarSerialised)

      // Move to review stage
      state.currentArgKey = ''
      state.currentArgValue = ''
      state.highlightedHeaderArg = ''
      state.headerArguments.Angle = '360deg'
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        commandName: state.commandName,
        headerArguments: state.headerArguments,
        stage: 'review',
        reviewValidationError: undefined,
      })

      await cmdBar.submit()

      // Assert we have a revolve in the code (the second one; first was removed to avoid order-dependent lint)
      const code = await editor.getCurrentCode()
      expect(code).toContain('revolve')

      // Final sanity check: assert no errors in code pane
      await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
    })
  })

  test('Can select split edges for fillet', async ({
    context,
    homePage,
    scene,
    cmdBar,
    page,
    toolbar,
    editor,
  }) => {
    const [clickEdge] = scene.makeMouseHelpers(0.1709, 0.4864, {
      format: 'ratio',
    })
    await context.addInitScript((code) => {
      localStorage.setItem('persistCode', code)
    }, testCode)

    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    // Set camera position for optimal edge viewing
    await scene.moveCameraTo(
      { x: 5.06, y: 25.19, z: 21.78 },
      { x: 7.72, y: 11.81, z: 8.2 }
    )

    // Click on the split edge using ratio clicks to select it first
    await clickEdge()

    // Base state object that we'll mutate as we progress
    const state: CmdBarSerialised = {
      commandName: 'Fillet',
      currentArgKey: 'selection',
      currentArgValue: '',
      headerArguments: {
        Selection: '',
        Radius: '',
      },
      highlightedHeaderArg: 'selection',
      stage: 'arguments',
    }

    // Click fillet tool - the edge should already be selected
    await toolbar.filletButton.click()
    await cmdBar.expectState(state)

    // Edge should already be selected, progress to radius
    state.currentArgKey = 'radius'
    state.currentArgValue = '5' // Default radius
    state.headerArguments.Selection = '1 edge'
    state.highlightedHeaderArg = 'radius'
    await cmdBar.progressCmdBar()
    await cmdBar.expectState(state)

    // Set radius to 0.75mm
    await cmdBar.currentArgumentInput.locator('.cm-content').fill('0.75')
    state.currentArgValue = '0.75'
    state.headerArguments.Radius = '0.75'
    await cmdBar.progressCmdBar()
    await cmdBar.expectState({
      commandName: state.commandName,
      headerArguments: state.headerArguments,
      stage: 'review',
      reviewValidationError: undefined,
    })

    await cmdBar.submit()

    // Assert code contains fillet
    await editor.expectEditor.toContain('fillet')

    // Final sanity check: assert no errors in code pane
    await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
  })
})
