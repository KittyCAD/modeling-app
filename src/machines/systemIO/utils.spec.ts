import { expect, describe, it } from 'vitest'
import { prepareMlEphantNewFileRequest } from '@src/machines/systemIO/utils'

describe('System IO Utils', () => {
  it(`Properly reconstructs paths from Zookeeper new file requests`, () => {
    const preparedPayload = prepareMlEphantNewFileRequest({
      projectNameCurrentlyOpened: 'some-project',
      fileFocusedOnInEditor: {
        name: 'main.kcl',
        path: '/some-project/main.kcl',
        children: null,
      },
      toolOutput: {
        status_code: 201,
        type: 'edit_kcl_code',
        project_name: 'some-project',
        outputs: {
          '7/main.kcl':
            '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
          '9/main.kcl':
            '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\nboxColor = "#00ff00"\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n  |> appearance(color = boxColor)\n',
          '4/main.kcl':
            '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
          '6/main.kcl':
            '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
          '5/main.kcl':
            '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
          'main.kcl': '',
          '1/main.kcl':
            '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
          '8/main.kcl':
            '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
          '3/main.kcl':
            '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
          '2/main.kcl':
            '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
        },
      },
    })

    expect(preparedPayload).toBeDefined()
    expect(preparedPayload?.files).toEqual([
      {
        requestedFileName: '7/main.kcl',
        requestedCode:
          '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
        requestedProjectName: 'some-project',
      },
      {
        requestedFileName: '9/main.kcl',
        requestedCode:
          '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\nboxColor = "#00ff00"\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n  |> appearance(color = boxColor)\n',
        requestedProjectName: 'some-project',
      },
      {
        requestedFileName: '4/main.kcl',
        requestedCode:
          '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
        requestedProjectName: 'some-project',
      },
      {
        requestedFileName: '6/main.kcl',
        requestedCode:
          '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
        requestedProjectName: 'some-project',
      },
      {
        requestedFileName: '5/main.kcl',
        requestedCode:
          '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
        requestedProjectName: 'some-project',
      },
      {
        requestedFileName: 'main.kcl',
        requestedCode: '',
        requestedProjectName: 'some-project',
      },
      {
        requestedFileName: '1/main.kcl',
        requestedCode:
          '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
        requestedProjectName: 'some-project',
      },
      {
        requestedFileName: '8/main.kcl',
        requestedCode:
          '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
        requestedProjectName: 'some-project',
      },
      {
        requestedFileName: '3/main.kcl',
        requestedCode:
          '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
        requestedProjectName: 'some-project',
      },
      {
        requestedFileName: '2/main.kcl',
        requestedCode:
          '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
        requestedProjectName: 'some-project',
      },
    ])
  })
})
