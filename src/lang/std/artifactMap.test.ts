import { makeDefaultPlanes, parse, initPromise, Program } from 'lang/wasm'
import {
  OrderedCommand,
  ResponseMap,
  createArtifactMap,
  filterArtifacts,
  expandPlane,
  expandPath,
  expandExtrusion,
  ArtifactMap,
} from './artifactMap'
import { err } from 'lib/trap'
import { engineCommandManager, kclManager } from 'lib/singletons'
import { CI, VITE_KC_DEV_TOKEN } from 'env'
import fsp from 'fs/promises'
import fs from 'fs'
import { chromium } from 'playwright'
import * as d3 from 'd3-force'

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
    let theMap: ReturnType<typeof createArtifactMap>
    it('setup', () => {
      // putting this logic in here because describe blocks runs before beforeAll has finished
      const {
        orderedCommands,
        responseMap,
        ast: _ast,
      } = getCommands('exampleCode1')
      ast = _ast
      theMap = createArtifactMap({ orderedCommands, responseMap, ast })
    })

    it('there should be two planes for the extrusion and the sketch on face', () => {
      const planes = [...filterArtifacts(theMap, ['plane'])].map((plane) =>
        expandPlane(plane[1], theMap)
      )
      expect(planes).toHaveLength(1)
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
        const firstExtrusionIsACubeIE6Sides = 6
        expect(extrusion.surfs.length).toBe(
          !index ? firstExtrusionIsACubeIE6Sides : 5
        )
      })
    })

    it('screenshot graph', async () => {
      await GraphArtifactMap(theMap, 1400, 1400, 'exampleCode1.png')
    }, 20000)
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

async function GraphArtifactMap(theMap: ArtifactMap, sizeX: number, sizeY: number, imageName: string) {
  const nodes: Array<{ id: string; label: string }> = []
  const edges: Array<{ source: string; target: string; label: string }> = []
  for (const [commandId, artifact] of Array.from(theMap).reverse()) {
    nodes.push({
      id: commandId,
      label: `${artifact.type}-${commandId.slice(0, 6)}`,
    })
    Object.entries(artifact).forEach(([propName, value]) => {
      if (
        propName === 'type' ||
        propName === 'codeRef' ||
        propName === 'subType'
      )
        return
      if (Array.isArray(value))
        value.forEach((v) => {
          edges.push({ source: commandId, target: v, label: propName })
        })
      if (typeof value === 'string' && value)
        edges.push({ source: commandId, target: value, label: propName })
    })
  }

  // Create a force simulation to calculate node positions
  const simulation = d3
    .forceSimulation(nodes as any)
    .force(
      'link',
      d3
        .forceLink(edges)
        .id((d: any) => d.id)
        .distance(100)
    )
    .force('charge', d3.forceManyBody().strength(-300))
    .force('center', d3.forceCenter(300, 200))
    .stop()

  // Run the simulation
  for (let i = 0; i < 300; ++i) simulation.tick()

  // Create traces for Plotly
  const nodeTrace = {
    x: nodes.map((node: any) => node.x),
    y: nodes.map((node: any) => node.y),
    text: nodes.map((node) => node.label), // Use the custom label
    mode: 'markers+text',
    type: 'scatter',
    marker: { size: 20, color: 'gray' }, // Nodes in gray
    textfont: { size: 14, color: 'black' }, // Labels in black
    textposition: 'top center', // Position text on top
  }

  const edgeTrace = {
    x: [],
    y: [],
    mode: 'lines',
    type: 'scatter',
    line: { width: 2, color: 'lightgray' }, // Edges in light gray
  }

  const annotations: any[] = []

  edges.forEach((edge) => {
    const sourceNode = nodes.find((node: any) => node.id === (edge as any).source.id)
    const targetNode = nodes.find((node: any) => node.id === (edge as any).target.id)

    // Check if nodes are found
    if (!sourceNode || !targetNode) {
      throw new Error(
        // @ts-ignore
        `Node not found: ${!sourceNode ? edge.source.id : edge.target.id}`
      )
    }

    // @ts-ignore
    edgeTrace.x.push(sourceNode.x, targetNode.x, null)
    // @ts-ignore
    edgeTrace.y.push(sourceNode.y, targetNode.y, null)
    
    // Calculate offset for arrowhead
    const offsetFactor = 0.9 // Adjust this factor to control the offset distance
    // @ts-ignore
    const offsetX = (targetNode.x - sourceNode.x) * offsetFactor
    // @ts-ignore
    const offsetY = (targetNode.y - sourceNode.y) * offsetFactor
    
    // Add arrowhead annotation with offset
    annotations.push({
      // @ts-ignore
      ax: sourceNode.x,
      // @ts-ignore
      ay: sourceNode.y,
      // @ts-ignore
      x: targetNode.x - offsetX,
      // @ts-ignore
      y: targetNode.y - offsetY,
      xref: 'x',
      yref: 'y',
      axref: 'x',
      ayref: 'y',
      showarrow: true,
      arrowhead: 2,
      arrowsize: 1,
      arrowwidth: 2,
      arrowcolor: 'darkgray', // Arrowheads in dark gray
    })
    
    // Add edge label annotation closer to the edge tail (25% of the length)
    // @ts-ignore
    const labelX = sourceNode.x * 0.75 + targetNode.x * 0.25
    // @ts-ignore
    const labelY = sourceNode.y * 0.75 + targetNode.y * 0.25
    annotations.push({
      x: labelX,
      y: labelY,
      xref: 'x',
      yref: 'y',
      text: edge.label,
      showarrow: false,
      font: { size: 12, color: 'black' }, // Edge labels in black
      align: 'center',
    })
  })

  const data = [edgeTrace, nodeTrace]

  const layout = {
    // title: 'Force-Directed Graph with Nodes and Edges',
    xaxis: { showgrid: false, zeroline: false, showticklabels: false },
    yaxis: { showgrid: false, zeroline: false, showticklabels: false },
    showlegend: false,
    annotations: annotations,
  }

  // Export to PNG using Playwright
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setContent(`
    <html>
      <head>
        <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
      </head>
      <body>
        <div id="plotly-graph" style="width:${sizeX}px;height:${sizeY}px;"></div>
        <script>
          Plotly.newPlot('plotly-graph', ${JSON.stringify(
            data
          )}, ${JSON.stringify(layout)})
        </script>
      </body>
    </html>
  `)
  await page.waitForSelector('#plotly-graph')
  const element = await page.$('#plotly-graph')
  // @ts-ignore
  await element.screenshot({ path: `src/lang/std/artifactMapGraphs/${imageName}` })
  await browser.close()

  // Check if the PNG file was created
  expect(fs.existsSync(`src/lang/std/artifactMapGraphs/${imageName}`)).toBe(true)
}
