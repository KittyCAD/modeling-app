import { engineCommandManager, kclManager } from '@src/lib/singletons'
import { VITE_KC_DEV_TOKEN } from '@src/env'
import { getModuleIdByFileName, isArray } from '@src/lib/utils'
import { vi, inject } from 'vitest'
import { assertParse } from '@src/lang/wasm'
import { initPromise } from '@src/lang/wasmUtils'
import { getCodeRefsByArtifactId } from '@src/lang/std/artifactGraph'
import path from 'path'
import fs from 'node:fs'
import type { Selections } from '@src/lib/selections'

// Custom JSON snapshot utilities
const SNAPSHOTS_DIR = path.join(__dirname, '__snapshots__')
const SNAPSHOTS_FILE = path.join(SNAPSHOTS_DIR, 'modifyWithTTC.test.json')

interface JsonSnapshots {
  [testName: string]: any
}

function loadJsonSnapshots(): JsonSnapshots {
  try {
    if (fs.existsSync(SNAPSHOTS_FILE)) {
      const content = fs.readFileSync(SNAPSHOTS_FILE, 'utf-8')
      return JSON.parse(content)
    }
  } catch (error) {
    console.warn('Failed to load JSON snapshots:', error)
  }
  return {}
}

function saveJsonSnapshots(snapshots: JsonSnapshots): void {
  try {
    // Create directory if it doesn't exist
    if (!fs.existsSync(SNAPSHOTS_DIR)) {
      fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true })
    }
    fs.writeFileSync(
      SNAPSHOTS_FILE,
      JSON.stringify(snapshots, null, 2),
      'utf-8'
    )
  } catch (error) {
    console.error('Failed to save JSON snapshots:', error)
    throw error
  }
}

function expectJsonSnapshot(testName: string, data: any): void {
  const snapshots = loadJsonSnapshots()
  const serializedData = JSON.parse(JSON.stringify(data)) // Deep clone to remove any functions/symbols

  // Try to detect update mode using inject
  let isUpdateMode = false
  try {
    isUpdateMode = inject('vitest:updateSnapshots') || false
  } catch {
    // If inject fails, fall back to environment variable approach
    isUpdateMode =
      process.env.VITEST_UPDATE_SNAPSHOTS === 'true' ||
      process.env.UPDATE_SNAPSHOTS === 'true'
  }

  if (isUpdateMode) {
    // Update mode: save the new snapshot
    snapshots[testName] = serializedData
    saveJsonSnapshots(snapshots)
  } else {
    // Compare mode: check against existing snapshot
    if (!(testName in snapshots)) {
      throw new Error(
        `Snapshot for "${testName}" not found. ` +
          `To create or update snapshots, run:\n` +
          `  npm test -- --run src/machines/modifyWithTTC.test.ts -u\n` +
          `Or set the UPDATE_SNAPSHOTS environment variable:\n` +
          `  UPDATE_SNAPSHOTS=true npm test -- --run src/machines/modifyWithTTC.test.ts`
      )
    }

    const existing = snapshots[testName]
    try {
      expect(serializedData).toEqual(existing)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      throw new Error(
        `Snapshot mismatch for "${testName}". ` +
          `To update snapshots, run:\n` +
          `  npm test -- --run src/machines/modifyWithTTC.test.ts -u\n` +
          `Or set the UPDATE_SNAPSHOTS environment variable:\n` +
          `  UPDATE_SNAPSHOTS=true npm test -- --run src/machines/modifyWithTTC.test.ts\n\n` +
          `Original error: ${errorMessage}`
      )
    }
  }
}

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
  artifactSearchSnippet?: { fileName: string; content: string; type: string }
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
    artifactSearchSnippet: {
      content: 'line(end = [19.66, -116.4])',
      fileName: 'main.kcl',
      type: 'wall',
    },
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
    artifactSearchSnippet: {
      fileName: 'ball-bearing.kcl',
      content: 'yLine(length = stockThickness)',
      type: 'wall',
    },
    prompt:
      'Can you please pattern this nut 4 times, the same way the bolt and washer has been done already.',
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

const pipeFlangeAssembly = loadSampleProject('pipe-flange-assembly/main.kcl')
const originalMain = pipeFlangeAssembly['main.kcl']
pipeFlangeAssembly['main.kcl'] = pipeFlangeAssembly['main.kcl'].replace(
  `translate(x = mountingHolePlacementDiameter / 2, y = 0, z = -(flangeBackHeight * 2 + gasketThickness + flangeBaseThickness + washerThickness + hexNutThickness))
  |> patternCircular3d(
       %,
       instances = 4,
       axis = [0, 0, 1],
       center = [0, 0, 0],
       arcDegrees = 360,
       rotateDuplicates = false,
     )`,
  'translate(x = mountingHolePlacementDiameter / 2, y = 0, z = -(flangeBackHeight * 2 + gasketThickness + flangeBaseThickness + washerThickness + hexNutThickness))'
)

cases.push(
  createCaseData({
    // angledLine(angle = 210, length = hexNutFlatLength)
    testName: 'try and pattern an inserted part',
    artifactSearchSnippet: {
      fileName: '95479a127-hex-nut.kcl',
      content: 'angledLine(angle = 210, length = hexNutFlatLength)',
      type: 'wall',
    },
    prompt: 'Change this to red please, #ff0000',
    inputFiles: pipeFlangeAssembly,
    expectFilesCallBack: ({ fileName, content }) =>
      fileName === 'main' ? originalMain : content,
  })
)

// Store original method to restore in afterAll

beforeAll(async () => {
  await initPromise

  // THESE TEST WILL FAIL without VITE_KC_DEV_TOKEN set in .env.development.local
  await new Promise((resolve) => {
    engineCommandManager.start({
      token: VITE_KC_DEV_TOKEN,
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

// Create a utility to spy on fetch requests, similar to the Playwright fixture
interface CapturedRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: {
    [key: string]: any
    files?: Record<string, string>
  }
  timestamp: number
}

interface FetchSpyOptions {
  captureAllRequests?: boolean
  mockResponses?: Record<string, any>
}

function createFetchSpy(options: FetchSpyOptions = {}) {
  const capturedRequests: CapturedRequest[] = []
  const allFetchCalls: string[] = []

  // Store test context for file mapping
  let currentTestFiles: Record<string, string> = {}

  // Create a mock fetch that handles the specific text-to-cad endpoints
  const mockFetch = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      const urlString = url.toString()
      allFetchCalls.push(urlString)

      // Capture requests based on options
      const shouldCapture =
        options.captureAllRequests ||
        (urlString.includes('text-to-cad') && urlString.includes('iteration'))

      if (shouldCapture) {
        try {
          const headers: Record<string, string> = {}
          if (init?.headers) {
            // Convert headers to a plain object
            if (init.headers instanceof Headers) {
              init.headers.forEach((value, key) => {
                headers[key] = value
              })
            } else if (isArray(init.headers)) {
              init.headers.forEach(([key, value]) => {
                headers[key] = value
              })
            } else {
              Object.assign(headers, init.headers)
            }
          }

          let requestBody: any = {}
          let files: Record<string, string> = {}

          // Parse multipart form data if present
          if (init?.body instanceof FormData) {
            // Extract the JSON body
            const bodyData = init.body.get('body')
            if (bodyData) {
              requestBody = JSON.parse(bodyData.toString())
            }

            // Extract files and map them to correct names using test context
            const fileContents: string[] = []
            for (const [key, value] of init.body.entries()) {
              if (key === 'files' && value instanceof File) {
                const text = await value.text()
                fileContents.push(text)
              }
            }

            // Map files to their correct names based on test context
            const testFileNames = Object.keys(currentTestFiles)
            fileContents.forEach((content, index) => {
              // Find matching file by content
              const matchingFileName = testFileNames.find(
                (fileName) => currentTestFiles[fileName] === content
              )

              if (matchingFileName) {
                files[matchingFileName] = content
              } else {
                // Fallback if no exact match found
                files[testFileNames[index] || `file-${index + 1}.kcl`] = content
              }
            })
          } else if (init?.body && typeof init.body === 'string') {
            // Parse multipart data manually like Playwright does
            const postData = init.body

            // Extract boundary from Content-Type header or find it in the data
            const boundary = postData.match(
              /------WebKitFormBoundary[^\r\n]*/
            )?.[0]
            if (boundary) {
              const parts = postData
                .split(boundary)
                .filter((part) => part.trim())

              for (const part of parts) {
                // Skip the final boundary marker
                if (part.startsWith('--')) continue

                const nameMatch = part.match(/name="([^"]+)"/)
                if (!nameMatch) continue

                const name = nameMatch[1]
                const content = part.split(/\r?\n\r?\n/)[1]?.trim()
                if (!content) continue

                if (name === 'body') {
                  requestBody = JSON.parse(content)
                } else {
                  // This should be a file with the original filename as the key
                  files[name] = content
                }
              }
            }
          } else if (init?.body) {
            // Handle JSON body
            try {
              requestBody = JSON.parse(init.body.toString())
            } catch {
              requestBody = { raw: init.body.toString() }
            }
          }

          capturedRequests.push({
            url: urlString,
            method: init?.method || 'GET',
            headers,
            body: {
              ...requestBody,
              files,
            },
            timestamp: Date.now(),
          })
        } catch (error) {
          console.error('Error capturing request:', error)
        }
      }

      // Check for custom mock responses
      if (options.mockResponses) {
        for (const [pattern, response] of Object.entries(
          options.mockResponses
        )) {
          if (urlString.includes(pattern)) {
            return new Response(JSON.stringify(response), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          }
        }
      }

      // Mock text-to-cad iteration endpoint
      if (
        urlString.includes('text-to-cad') &&
        urlString.includes('iteration')
      ) {
        return new Response(
          JSON.stringify({
            id: '550e8400-e29b-41d4-a716-446655440000',
            status: 'queued',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      // Mock the async operations status endpoint
      if (urlString.includes('async/operations/')) {
        return new Response(
          JSON.stringify({
            id: '550e8400-e29b-41d4-a716-446655440000',
            status: 'completed',
            outputs: {
              'main.kcl': 'mocked KCL content with appearance applied',
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      // For any other requests, return a basic successful response to avoid network errors
      return new Response(JSON.stringify({ mocked: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  ) as typeof global.fetch

  // Use vi.stubGlobal for comprehensive mocking
  vi.stubGlobal('fetch', mockFetch)

  return {
    getCapturedRequests: () => capturedRequests,
    getRequestsMatching: (predicate: (req: CapturedRequest) => boolean) =>
      capturedRequests.filter(predicate),
    getTextToCadRequests: () =>
      capturedRequests.filter((req) => req.url.includes('text-to-cad')),
    getAllFetchCalls: () => allFetchCalls,
    clearCapturedRequests: () => capturedRequests.splice(0),
    setTestFiles: (files: Record<string, string>) => {
      currentTestFiles = files
    },
    restore: () => {
      vi.unstubAllGlobals()
    },
  }
}

// Add this function before the test cases
// Utility function to wait for a condition to be met
const waitForCondition = async (
  condition: () => boolean,
  timeout = 5000,
  interval = 100
) => {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    try {
      if (condition()) {
        return true
      }
    } catch {
      // Ignore errors, keep polling
    }

    // Wait for the next interval
    await new Promise((resolve) => setTimeout(resolve, interval))
  }

  // Last attempt before failing
  return condition()
}

// Add this function before the test cases

// Utility function to set up a test project directory with KCL files
async function setupTestProjectWithImports(testFiles: Record<string, string>) {
  const os = require('os')
  const fs = require('fs/promises')
  const path = require('path')

  const testProjectDir = path.join(os.tmpdir(), `kcl-test-${Date.now()}`)

  // Set up test files
  await fs.mkdir(testProjectDir, { recursive: true })

  // Write all the test files
  for (const [filename, content] of Object.entries(testFiles)) {
    await fs.writeFile(path.join(testProjectDir, filename), content)
  }

  // Configure the FileSystemManager to use our test directory
  const { fileSystemManager } = await import('@src/lang/std/fileSystemManager')
  fileSystemManager.dir = testProjectDir

  return {
    projectDir: testProjectDir,
    cleanup: async () => {
      try {
        await fs.rm(testProjectDir, { recursive: true })
      } catch {
        // Ignore cleanup errors
      }
    },
  }
}

describe('When prompting modify with TTC, prompt:', () => {
  cases.forEach(
    ({ prompt, inputFiles, artifactSearchSnippet, expectedFiles }) => {
      it(`${prompt}`, async () => {
        const mainFile = inputFiles['main.kcl']

        const { cleanup } = await setupTestProjectWithImports(inputFiles)

        // Set up fetch spy to capture requests
        const fetchSpy = createFetchSpy()

        // Set the test files for proper filename mapping
        fetchSpy.setTestFiles(inputFiles)

        // Set up mock token for authentication
        const mockToken = 'test-token-123'
        localStorage.setItem('TOKEN_PERSIST_KEY', mockToken)

        try {
          // Parse and execute the main file with imports
          const ast = assertParse(mainFile)

          // Execute the AST - the fileSystemManager.dir will be used for import resolution
          await kclManager.executeAst({ ast })

          expect(kclManager.errors).toEqual([])

          let selections: Selections = {
            graphSelections: [],
            otherSelections: [],
          }

          if (artifactSearchSnippet) {
            let moduleId = getModuleIdByFileName(
              artifactSearchSnippet.fileName,
              kclManager.execState.filenames
            )
            if (artifactSearchSnippet.fileName === 'main.kcl') {
              moduleId = 0
            }
            const moduleContent = inputFiles[artifactSearchSnippet.fileName]
            if (moduleId === -1) {
              throw new Error(
                `Module ID not found for file: ${artifactSearchSnippet.fileName}`
              )
            }
            if (!moduleContent) {
              throw new Error(
                `Module content not found for file: ${artifactSearchSnippet.fileName}`
              )
            }
            const indexOfInterest = moduleContent.indexOf(
              artifactSearchSnippet.content
            )

            const artifacts = [...kclManager.artifactGraph].filter(
              ([id, artifact]) => {
                const codeRefs = getCodeRefsByArtifactId(
                  id,
                  kclManager.artifactGraph
                )
                return (
                  artifact?.type === artifactSearchSnippet.type &&
                  codeRefs &&
                  codeRefs.find((ref) => {
                    return (
                      ref.range[0] <= indexOfInterest &&
                      ref.range[1] >= indexOfInterest &&
                      ref.range[2] === moduleId
                    )
                  })
                )
              }
            )
            const artifact = artifacts?.[0]?.[1]

            if (!artifact) {
              throw new Error('Artifact not found')
            }
            const codeRef = (getCodeRefsByArtifactId(
              artifact.id,
              kclManager.artifactGraph
            ) || [])[0]
            if (!codeRef) {
              throw new Error('Code reference not found for the artifact')
            }

            selections.graphSelections = [
              {
                artifact,
                codeRef,
              },
            ]
          }
          // Test that we can work with the imported content

          // Test direct call to promptToEditFlow instead of going through state machine
          const { promptToEditFlow } = await import('@src/lib/promptToEdit')

          // Create project files that match what the state machine would create
          const projectFiles = Object.entries(inputFiles).map(
            ([filename, content]) => ({
              type: 'kcl' as const,
              relPath: filename,
              absPath: filename,
              fileContents: content,
              execStateFileNamesIndex: Number(
                Object.entries(kclManager.execState.filenames).find(
                  ([_, value]) =>
                    value && value.type === 'Local' && value.value === filename
                )?.[0] || 0
              ),
            })
          )

          // Call promptToEditFlow directly
          const resultPromise = promptToEditFlow({
            prompt,
            selections,
            projectFiles,
            token: mockToken,
            artifactGraph: kclManager.artifactGraph,
            projectName: 'test-project',
            filePath: 'main.kcl',
          })

          // Wait for the request to be made
          await waitForCondition(
            () => {
              const requests = fetchSpy.getCapturedRequests()
              return requests.length > 0
            },
            10000,
            500
          )

          // Get and verify the captured request
          const capturedRequests = fetchSpy.getCapturedRequests()
          fetchSpy.getAllFetchCalls()

          if (capturedRequests.length === 0) {
            console.log(
              'No text-to-cad requests were captured. This might indicate an error in the flow.'
            )
            expect(capturedRequests).toHaveLength(1) // This will fail and show what was captured
          } else {
            const request = capturedRequests[0]
            const textToCadPayload = {
              ...request.body,
              // Normalize file names to make snapshots deterministic
              files: request.body.files,
              expectedFiles,
            }

            // Use custom JSON snapshot instead of Vitest's default format
            expectJsonSnapshot(prompt, textToCadPayload)
          }

          // Wait for the promise to resolve or reject
          try {
            await resultPromise
          } catch {
            // most likely get a auth error here for TTC, we don't actually care about the response.
            // just capturing the request
          }
        } finally {
          fetchSpy.restore()
          localStorage.removeItem('TOKEN_PERSIST_KEY')
          await cleanup()
        }
      }, 20_000) // Increase timeout to 20 seconds
    }
  )
})
