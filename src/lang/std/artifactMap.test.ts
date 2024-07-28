import { makeDefaultPlanes, parse, initPromise, Program } from 'lang/wasm'
import {
  OrderedCommand,
  ResponseMap,
  createLinker,
  filterArtifacts,
  expandPlane,
  expandPath,
  expandExtrusion,
} from './artifactMap'
import { err } from 'lib/trap'
import { engineCommandManager, kclManager } from 'lib/singletons'
import { CI, VITE_KC_DEV_TOKEN } from 'env'
import fsp from 'fs/promises'
import fs from 'fs'

/*
Note this is an integration test, these tests connect to our real dev server and make websocket commands.
It's needed for testing the artifactMap, as the artifactMap is tied to the websocket commands.
*/

const pathStart = 'src/lang/std/artifactMapCache'
const fullPath = `${pathStart}/artifactMapCache.json`

const exampleCode1 = `const sketch001 = startSketchOn('XY')
  |> startProfileAt([-5, -5], %)
  |> line([0, 10], %)
  |> line([10.55, 0], %, $seg01)
  |> line([0, -10], %, $seg02)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude001 = extrude(-10, sketch001)
  |> fillet({ radius: 5, tags: [seg01] }, %)
const sketch002 = startSketchOn(extrude001, seg02)
  |> startProfileAt([-2, -6], %)
  |> line([2, 3], %)
  |> line([2, -3], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude002 = extrude(5, sketch002)
`

// add more code snippets here and use `getCommands` to get the orderedCommands and responseMap for more tests
const codeToWriteCacheFor = {
  exampleCode1,
} as const

type CodeKey = keyof typeof codeToWriteCacheFor

type CacheShape = {
  [key in CodeKey]: {
    orderedCommands: OrderedCommand[]
    responseMap: ResponseMap
  }
}

beforeAll(async () => {
  await initPromise

  let parsed
  try {
    const file = await fsp.readFile(fullPath, 'utf-8')
    parsed = JSON.parse(file)
  } catch (e) {
    parsed = false
  }

  if (!CI && parsed) {
    // caching the results of the websocket commands makes testing this locally much faster
    // real calls to the engine are needed to test the artifact map
    // bust the cache with: `rm -rf src/lang/std/artifactMapCache`
    return
  }

  // THESE TEST WILL FAIL without VITE_KC_DEV_TOKEN set in .env.development.local
  engineCommandManager.start({
    disableWebRTC: true,
    token: VITE_KC_DEV_TOKEN,
    // there does seem to be a minimum resolution, not sure what it is but 256 works ok.
    width: 256,
    height: 256,
    executeCode: () => {},
    makeDefaultPlanes: () => makeDefaultPlanes(engineCommandManager),
    setMediaStream: () => {},
    setIsStreamReady: () => {},
    modifyGrid: async () => {},
  })
  await engineCommandManager.waitForReady

  const cacheEntries = Object.entries(codeToWriteCacheFor) as [
    CodeKey,
    string
  ][]
  const cacheToWriteToFileTemp: Partial<CacheShape> = {}
  for (const [codeKey, code] of cacheEntries) {
    const ast = parse(code)
    if (err(ast)) {
      console.error(ast)
      throw ast
    }
    await kclManager.executeAst(ast)

    cacheToWriteToFileTemp[codeKey] = {
      orderedCommands: engineCommandManager.orderedCommands,
      responseMap: engineCommandManager.responseMap,
    }
  }
  const cache = JSON.stringify(cacheToWriteToFileTemp)

  await fsp.mkdir(pathStart, { recursive: true })
  await fsp.writeFile(fullPath, cache)
}, 20_000)

afterAll(() => {
  engineCommandManager.tearDown()
})

describe('testing createLinker', () => {
  describe('code with an extrusion, fillet and sketch of face:', () => {
    let ast: Program
    let theMap: ReturnType<typeof createLinker>
    it('setup', () => {
      // putting this logic in here because describe blocks runs before beforeAll has finished
      const {
        orderedCommands,
        responseMap,
        ast: _ast,
      } = getCommands('exampleCode1')
      ast = _ast
      theMap = createLinker({ orderedCommands, responseMap, ast })
    })

    it('there should be two planes for the extrusion and the sketch on face', () => {
      const planes = [...filterArtifacts(theMap, ['plane'])].map((plane) =>
        expandPlane(plane[1], theMap)
      )
      expect(planes).toHaveLength(2)
      planes.forEach((path) => {
        expect(path.type).toBe('plane')
      })
    })
    it('there should be two paths for the extrusion and the sketch on face', () => {
      const paths = [...filterArtifacts(theMap, ['path'])].map((path) =>
        expandPath(path[1], theMap)
      )
      expect(paths).toHaveLength(2)
      paths.forEach((path) => {
        if (err(path)) throw path
        expect(path.type).toBe('path')
      })
    })

    it('there should be two extrusions, for the original and the sketchOnFace, the first extrusion should have 6 sides of the cube', () => {
      const extrusions = [...filterArtifacts(theMap, ['extrusion'])].map(
        (extrusion) => expandExtrusion(extrusion[1], theMap)
      )
      expect(extrusions).toHaveLength(2)
      extrusions.forEach((extrusion, index) => {
        if (err(extrusion)) throw extrusion
        expect(extrusion.type).toBe('extrusion')
        expect(extrusion.surfs.length).toBe(!index ? 6 : 0)
      })
    })
  })
})

function getCommands(codeKey: CodeKey): CacheShape[CodeKey] & { ast: Program } {
  const ast = parse(codeKey)
  if (err(ast)) {
    console.error(ast)
    throw ast
  }
  const file = fs.readFileSync(fullPath, 'utf-8')
  const parsed: CacheShape = JSON.parse(file)
  // these either already exist from the last run, or were created in
  const orderedCommands = parsed.exampleCode1.orderedCommands
  const responseMap = parsed.exampleCode1.responseMap
  return {
    orderedCommands,
    responseMap,
    ast,
  }
}
