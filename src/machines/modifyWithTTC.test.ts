import { engineCommandManager } from '@src/lib/singletons'
import env from '@src/env'
import { vi } from 'vitest'
import { initPromise } from '@src/lang/wasmUtils'
import path from 'path'
import fs from 'node:fs'

/**
 * This test is some what unique, and in fact it doesn't assert anything aside from capturing snapshots
 * The snap shots are the request to the ML iteration endpoint, so that the ML team can use these in their own
 * test harness.
 * The reason why this is done at all is because the frontEnd has to be the source of truth because in the case of a user
 * selecting something in the UI, the UI turns that artifactGraph selection into meta prompt that accompanies the user's prompt
 *
 * These are down as unit tests, because when a user selects something in the UI, that click resolves to an artifact in the artifactGraph
 * So long as we're able to find the same artifact in the graph, we don't need the click.
 * So far `artifactSearchSnippet` that has the file name, a searchString (some code in that file) and the artifact type ('wall', sweepEdge' etc) has
 * been enough to find the artifact in the graph. That might need to change with more examples OR later if we have rock-solid stable ids
 * We can possible just hard-code the ids and have that be reliable.
 *
 * The snapshot code is custom, instead of using Vitest's built-in snapshot functionality.
 * This is purely because we want pure JSON to make this easy for the ML team to ingest
 * It's been made to still work with the same `-u` flag, so it won't feel meaningfully different
 * When they need to be updated.
 *
 * The way to add more examples is pushing new cases to `cases` array, you should be able
 * to follow the patterns of other examples.
 */

export function loadSampleProject(fileName: string): {
  [fileName: string]: string
} {
  // public/kcl-samples/pillow-block-bearing/main.kcl
  const projectPath = path.join('public', 'kcl-samples', fileName)
  // load in all .kcl files in this directory using fs (sync)
  const files: { [fileName: string]: string } = {}
  const dir = path.dirname(projectPath)
  const fileNames = fs.readdirSync(dir)

  for (const file of fileNames) {
    if (file.endsWith('.kcl')) {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8')
      files[file] = content
    }
  }

  return files
}

type TestCase = {
  testName: string
  prompt: string
  inputFiles: { [fileName: string]: string }
  expectedFiles: { [fileName: string]: string }
  artifactSearchSnippet?: { fileName: string; content: string; type: string }[]
}

function createCaseData({
  prompt,
  inputFiles,
  artifactSearchSnippet,
  expectFilesCallBack,
  testName,
}: Omit<TestCase, 'expectedFiles'> & {
  expectFilesCallBack: (input: { fileName: string; content: string }) => string
}): TestCase {
  return {
    testName,
    prompt,
    inputFiles,
    artifactSearchSnippet,
    expectedFiles: Object.fromEntries(
      Object.entries(inputFiles).map(([fileName, content]) => [
        fileName,
        expectFilesCallBack({ fileName, content }),
      ])
    ),
  }
}

const cases: TestCase[] = [
  //   // Add the static test case
  createCaseData({
    testName: 'change color',
    prompt: 'make this neon green please, use #39FF14',
    artifactSearchSnippet: [
      {
        content: 'line(end = [19.66, -116.4])',
        fileName: 'main.kcl',
        type: 'wall',
      },
    ],
    expectFilesCallBack: ({ fileName, content }) => {
      if (fileName !== 'main.kcl') return content
      return content.replace(
        'extrude001 = extrude(profile001, length = 200)',
        `extrude001 = extrude(profile001, length = 200)
  |> appearance(color = "#39FF14")`
      )
    },
    inputFiles: {
      'main.kcl': `import "b.kcl" as b
sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [57.81, 250.51])
  |> line(end = [121.13, 56.63], tag = $seg02)
  |> line(end = [83.37, -34.61], tag = $seg01)
  |> line(end = [19.66, -116.4])
  |> line(end = [-221.8, -41.69])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 200)
sketch002 = startSketchOn(XZ)
  |> startProfile(at = [-73.64, -42.89])
  |> xLine(length = 173.71)
  |> line(end = [-22.12, -94.4])
  |> line(end = [-22.12, -50.4])
  |> line(end = [-22.12, -94.4])
  |> line(end = [-22.12, -50.4])
  |> xLine(length = -156.98)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude002 = extrude(sketch002, length = 50)
b
`,
      'b.kcl': `sketch003 = startSketchOn(XY)
  |> startProfile(at = [52.92, 157.81])
  |> angledLine(angle = 0, length = 176.4, tag = $rectangleSegmentA001)
  |> angledLine(
       angle = segAng(rectangleSegmentA001) - 90,
       length = 53.4,
       tag = $rectangleSegmentB001,
     )
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $rectangleSegmentC001)
  |> line(end = [-22.12, -50.4])
  |> line(end = [-22.12, -94.4])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude(sketch003, length = 20)
`,
    },
  }),

  // Load pillow block files and add as another test case
  createCaseData({
    testName: 'change color on imported file',
    artifactSearchSnippet: [
      {
        fileName: 'ball-bearing.kcl',
        content: 'yLine(length = stockThickness)',
        type: 'wall',
      },
    ],
    prompt: 'Change this to red please, #ff0000',
    inputFiles: loadSampleProject('pillow-block-bearing/main.kcl'),
    expectFilesCallBack: ({ fileName, content }) =>
      fileName === 'ball-bearing.kcl'
        ? content.replace(
            'appearance(%, color = "#f0f0f0")',
            'appearance(%, color = "#ff0000")'
          )
        : content,
  }),
]

const patternHoleStarterCode: { [fileName: string]: string } = {
  'main.kcl': `flangeHolesR = 6
flangeBodySketch = startSketchOn(XY)
flangeBodyProfile = circle(flangeBodySketch, center = [0, 0], radius = 100)
flangePlate = extrude(flangeBodyProfile, length = 5)
higherPlane = offsetPlane(XY, offset = 10)
innerBoreSketch = startSketchOn(higherPlane)
innerBoreProfile = circle(innerBoreSketch, center = [0, 0], radius = 49.28)
innerBoreCylinder = extrude(innerBoreProfile, length = -10)
flangeBody = subtract([flangePlate], tools = [innerBoreCylinder])
mountingHoleSketch = startSketchOn(higherPlane)
mountingHoleProfile = circle(mountingHoleSketch, center = [75, 0], radius = flangeHolesR)
mountingHoleCylinders = extrude(mountingHoleProfile, length = -30)
`,
}

cases.push(
  createCaseData({
    testName: 'pattern holes',
    artifactSearchSnippet: [
      {
        fileName: 'main.kcl',
        content:
          'circle(mountingHoleSketch, center = [75, 0], radius = flangeHolesR)',
        type: 'wall',
      },
    ],
    prompt:
      'pattern this cylinder 6 times around the center of the flange, before subtracting it from the flange',
    inputFiles: patternHoleStarterCode,
    expectFilesCallBack: ({ fileName, content }) => {
      if (fileName !== 'main.kcl') return content
      return content.replace(
        'extrude(mountingHoleProfile, length = -30)',
        `extrude(mountingHoleProfile, length = -30)
  |> patternCircular3d(instances = 6, axis = Z, center = [0, 0, 0])
flange = subtract([flangeBody], tools = [mountingHoleCylinders])`
      )
    },
  })
)
const filletStarterCode: { [fileName: string]: string } = {
  'main.kcl': `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [18.47, 15.31])
  |> yLine(length = 28.26)
  |> line(end = [55.52, 21.93])
  |> tangentialArc(endAbsolute = [136.09, 36.87])
  |> yLine(length = -45.48)
  |> xLine(length = -13.76)
  |> yLine(length = 8.61)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10)
`,
}

cases.push(
  createCaseData({
    testName: 'fillet shape',
    artifactSearchSnippet: [
      {
        fileName: 'main.kcl',
        content: 'yLine(length = 28.26)',
        type: 'sweepEdge',
      },
      {
        fileName: 'main.kcl',
        content: 'xLine(length = -13.76)',
        type: 'sweepEdge',
      },
    ],
    prompt: 'fillet these two edges please',
    inputFiles: filletStarterCode,
    expectFilesCallBack: ({ fileName, content }) => {
      if (fileName !== 'main.kcl') return content
      let newContent = content.replace(
        'extrude(profile001, length = 10)',
        `extrude(profile001, length = 10, tagEnd = $capEnd001)
  |> fillet(
       radius = 1,
       tags = [
         getCommonEdge(faces = [seg01, seg02]),
         getCommonEdge(faces = [seg03, capEnd001])
       ],
     )`
      )
      newContent = newContent.replace(
        'yLine(length = 28.26)',
        'yLine(length = 28.26, tag = $seg02)'
      )
      newContent = newContent.replace(
        'line(end = [55.52, 21.93])',
        'line(end = [55.52, 21.93], tag = $seg01)'
      )
      newContent = newContent.replace(
        'xLine(length = -13.76)',
        'xLine(length = -13.76, tag = $seg03)'
      )
      return newContent
    },
  })
)

// Store original method to restore in afterAll

beforeAll(async () => {
  await initPromise

  await new Promise((resolve) => {
    engineCommandManager.start({
      token: env().VITE_KITTYCAD_API_TOKEN,
      width: 256,
      height: 256,
      setMediaStream: () => {},
      setIsStreamReady: () => {},
      callbackOnEngineLiteConnect: () => {
        resolve(true)
      },
    })
  })
}, 30_000)

afterAll(() => {
  // Restore the original method

  engineCommandManager.tearDown()
})

// Define mock implementations that will be referenced in vi.mock calls
vi.mock('@src/components/SetHorVertDistanceModal', () => ({
  createInfoModal: vi.fn(() => ({
    open: vi.fn().mockResolvedValue({
      value: '10',
      segName: 'test',
      valueNode: {},
      newVariableInsertIndex: 0,
      sign: 1,
    }),
  })),
  GetInfoModal: vi.fn(),
}))

vi.mock('@src/components/SetAngleLengthModal', () => ({
  createSetAngleLengthModal: vi.fn(() => ({
    open: vi.fn().mockResolvedValue({
      value: '45',
      segName: 'test',
      valueNode: {},
      newVariableInsertIndex: 0,
      sign: 1,
    }),
  })),
  SetAngleLengthModal: vi.fn(),
}))
