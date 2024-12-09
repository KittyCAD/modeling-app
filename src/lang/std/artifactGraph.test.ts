import { makeDefaultPlanes, assertParse, initPromise, Program } from 'lang/wasm'
import { Models } from '@kittycad/lib'
import {
  OrderedCommand,
  ResponseMap,
  createArtifactGraph,
  filterArtifacts,
  expandPlane,
  expandPath,
  expandSweep,
  ArtifactGraph,
  expandSegment,
  getArtifactsToUpdate,
} from './artifactGraph'
import { err } from 'lib/trap'
import { engineCommandManager, kclManager } from 'lib/singletons'
import { VITE_KC_DEV_TOKEN } from 'env'
import fsp from 'fs/promises'
import fs from 'fs'
import { chromium } from 'playwright'
import * as d3 from 'd3-force'
import path from 'path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

/*
Note this is an integration test, these tests connect to our real dev server and make websocket commands.
It's needed for testing the artifactGraph, as it is tied to the websocket commands.
*/

const pathStart = 'src/lang/std/artifactMapCache'
const fullPath = `${pathStart}/artifactMapCache.json`

const exampleCode1 = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-5, -5], %)
  |> line([0, 10], %)
  |> line([10.55, 0], %, $seg01)
  |> line([0, -10], %, $seg02)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-10, sketch001)
  |> fillet({ radius: 5, tags: [seg01] }, %)
sketch002 = startSketchOn(extrude001, seg02)
  |> startProfileAt([-2, -6], %)
  |> line([2, 3], %)
  |> line([2, -3], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude002 = extrude(5, sketch002)
`

const exampleCodeNo3D = `sketch003 = startSketchOn('YZ')
  |> startProfileAt([5.82, 0], %)
  |> angledLine([180, 11.54], %, $rectangleSegmentA001)
  |> angledLine([
       segAng(rectangleSegmentA001) - 90,
       8.21
     ], %, $rectangleSegmentB001)
  |> angledLine([
       segAng(rectangleSegmentA001),
       -segLen(rectangleSegmentA001)
     ], %, $rectangleSegmentC001)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
sketch004 = startSketchOn('-XZ')
  |> startProfileAt([0, 14.36], %)
  |> line([15.49, 0.05], %)
  |> tangentialArcTo([0, 0], %)
  |> tangentialArcTo([-6.8, 8.17], %)
`

const exampleCodeNo3D = `sketch003 = startSketchOn('YZ')
  |> startProfileAt([5.82, 0], %)
  |> angledLine([180, 11.54], %, $rectangleSegmentA001)
  |> angledLine([
       segAng(rectangleSegmentA001) - 90,
       8.21
     ], %, $rectangleSegmentB001)
  |> angledLine([
       segAng(rectangleSegmentA001),
       -segLen(rectangleSegmentA001)
     ], %, $rectangleSegmentC001)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
sketch004 = startSketchOn('-XZ')
  |> startProfileAt([0, 14.36], %)
  |> line([15.49, 0.05], %)
  |> tangentialArcTo([0, 0], %)
  |> tangentialArcTo([-6.8, 8.17], %)
`

const sketchOnFaceOnFaceEtc = `sketch001 = startSketchOn('XZ')
|> startProfileAt([0, 0], %)
|> line([4, 8], %)
|> line([5, -8], %, $seg01)
|> lineTo([profileStartX(%), profileStartY(%)], %)
|> close(%)
extrude001 = extrude(6, sketch001)
sketch002 = startSketchOn(extrude001, seg01)
|> startProfileAt([-0.5, 0.5], %)
|> line([2, 5], %)
|> line([2, -5], %)
|> lineTo([profileStartX(%), profileStartY(%)], %)
|> close(%)
extrude002 = extrude(5, sketch002)
sketch003 = startSketchOn(extrude002, 'END')
|> startProfileAt([1, 1.5], %)
|> line([0.5, 2], %, $seg02)
|> line([1, -2], %)
|> lineTo([profileStartX(%), profileStartY(%)], %)
|> close(%)
extrude003 = extrude(4, sketch003)
sketch004 = startSketchOn(extrude003, seg02)
|> startProfileAt([-3, 14], %)
|> line([0.5, 1], %)
|> line([0.5, -2], %)
|> lineTo([profileStartX(%), profileStartY(%)], %)
|> close(%)
extrude004 = extrude(3, sketch004)
`
const exampleCodeOffsetPlanes = `
offsetPlane001 = offsetPlane("XY", 20)
offsetPlane002 = offsetPlane("XZ", -50)
offsetPlane003 = offsetPlane("YZ", 10)

sketch002 = startSketchOn(offsetPlane001)
  |> startProfileAt([0, 0], %)
  |> line([6.78, 15.01], %)
`

// add more code snippets here and use `getCommands` to get the orderedCommands and responseMap for more tests
const codeToWriteCacheFor = {
  exampleCode1,
  sketchOnFaceOnFaceEtc,
  exampleCodeNo3D,
  exampleCodeOffsetPlanes,
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

  // THESE TEST WILL FAIL without VITE_KC_DEV_TOKEN set in .env.development.local
  await new Promise((resolve) => {
    engineCommandManager.start({
      // disableWebRTC: true,
      token: VITE_KC_DEV_TOKEN,
      // there does seem to be a minimum resolution, not sure what it is but 256 works ok.
      width: 256,
      height: 256,
      makeDefaultPlanes: () => makeDefaultPlanes(engineCommandManager),
      setMediaStream: () => {},
      setIsStreamReady: () => {},
      modifyGrid: async () => {},
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      callbackOnEngineLiteConnect: async () => {
        const cacheEntries = Object.entries(codeToWriteCacheFor) as [
          CodeKey,
          string
        ][]
        const cacheToWriteToFileTemp: Partial<CacheShape> = {}
        for (const [codeKey, code] of cacheEntries) {
          const ast = assertParse(code)
          await kclManager.executeAst({ ast })

          cacheToWriteToFileTemp[codeKey] = {
            orderedCommands: engineCommandManager.orderedCommands,
            responseMap: engineCommandManager.responseMap,
          }
        }
        const cache = JSON.stringify(cacheToWriteToFileTemp)

        await fsp.mkdir(pathStart, { recursive: true })
        await fsp.writeFile(fullPath, cache)
        resolve(true)
      },
    })
  })
}, 20_000)

afterAll(() => {
  engineCommandManager.tearDown()
})

describe('testing createArtifactGraph', () => {
  describe('code with offset planes and a sketch:', () => {
    let ast: Program
    let theMap: ReturnType<typeof createArtifactGraph>

    it('setup', () => {
      // putting this logic in here because describe blocks runs before beforeAll has finished
      const {
        orderedCommands,
        responseMap,
        ast: _ast,
      } = getCommands('exampleCodeOffsetPlanes')
      ast = _ast
      theMap = createArtifactGraph({ orderedCommands, responseMap, ast })
    })

    it(`there should be one sketch`, () => {
      const sketches = [...filterArtifacts({ types: ['path'] }, theMap)].map(
        (path) => expandPath(path[1], theMap)
      )
      expect(sketches).toHaveLength(1)
      sketches.forEach((path) => {
        if (err(path)) throw path
        expect(path.type).toBe('path')
      })
    })

    it(`there should be three offsetPlanes`, () => {
      const offsetPlanes = [
        ...filterArtifacts({ types: ['plane'] }, theMap),
      ].map((plane) => expandPlane(plane[1], theMap))
      expect(offsetPlanes).toHaveLength(3)
      offsetPlanes.forEach((path) => {
        expect(path.type).toBe('plane')
      })
    })

    it(`Only one offset plane should have a path`, () => {
      const offsetPlanes = [
        ...filterArtifacts({ types: ['plane'] }, theMap),
      ].map((plane) => expandPlane(plane[1], theMap))
      const offsetPlaneWithPaths = offsetPlanes.filter(
        (plane) => plane.paths.length
      )
      expect(offsetPlaneWithPaths).toHaveLength(1)
    })
  })
  describe('code with an extrusion, fillet and sketch of face:', () => {
    let ast: Program
    let theMap: ReturnType<typeof createArtifactGraph>
    it('setup', () => {
      // putting this logic in here because describe blocks runs before beforeAll has finished
      const {
        orderedCommands,
        responseMap,
        ast: _ast,
      } = getCommands('exampleCode1')
      ast = _ast
      theMap = createArtifactGraph({ orderedCommands, responseMap, ast })
    })

    it('there should be two planes for the extrusion and the sketch on face', () => {
      const planes = [...filterArtifacts({ types: ['plane'] }, theMap)].map(
        (plane) => expandPlane(plane[1], theMap)
      )
      expect(planes).toHaveLength(1)
      planes.forEach((path) => {
        expect(path.type).toBe('plane')
      })
    })
    it('there should be two paths for the extrusion and the sketch on face', () => {
      const paths = [...filterArtifacts({ types: ['path'] }, theMap)].map(
        (path) => expandPath(path[1], theMap)
      )
      expect(paths).toHaveLength(2)
      paths.forEach((path) => {
        if (err(path)) throw path
        expect(path.type).toBe('path')
      })
    })

    it('there should be two extrusions, for the original and the sketchOnFace, the first extrusion should have 6 sides of the cube', () => {
      const extrusions = [...filterArtifacts({ types: ['sweep'] }, theMap)].map(
        (extrusion) => expandSweep(extrusion[1], theMap)
      )
      expect(extrusions).toHaveLength(2)
      extrusions.forEach((extrusion, index) => {
        if (err(extrusion)) throw extrusion
        expect(extrusion.type).toBe('sweep')
        const firstExtrusionIsACubeIE6Sides = 6
        const secondExtrusionIsATriangularPrismIE5Sides = 5
        expect(extrusion.surfaces.length).toBe(
          !index
            ? firstExtrusionIsACubeIE6Sides
            : secondExtrusionIsATriangularPrismIE5Sides
        )
      })
    })

    it('there should be 5 + 4 segments,  4 (+close) from the first extrusion and 3 (+close) from the second', () => {
      const segments = [...filterArtifacts({ types: ['segment'] }, theMap)].map(
        (segment) => expandSegment(segment[1], theMap)
      )
      expect(segments).toHaveLength(9)
    })

    it('snapshot of the artifactGraph', () => {
      const stableMap = new Map(
        [...theMap].map(([, artifact], index): [string, any] => {
          const stableValue: any = {}
          Object.entries(artifact).forEach(([propName, value]) => {
            if (
              propName === 'type' ||
              propName === 'codeRef' ||
              propName === 'subType'
            ) {
              stableValue[propName] = value
              return
            }
            if (Array.isArray(value))
              stableValue[propName] = value.map(() => 'UUID')
            if (typeof value === 'string' && value)
              stableValue[propName] = 'UUID'
          })
          return [`UUID-${index}`, stableValue]
        })
      )
      expect(stableMap).toMatchSnapshot()
    })

    it('screenshot graph', async () => {
      // Ostensibly this takes a screen shot of the graph of the artifactGraph
      // but it's it also tests that all of the id links are correct because if one
      // of the edges refers to a non-existent node, the graph will throw.
      // further more we can check that each edge is bi-directional, if it's not
      // by checking the arrow heads going both ways, on the graph.
      await GraphTheGraph(theMap, 2000, 2000, 'exampleCode1.png')
    }, 20000)
  })

  describe(`code with sketches but no extrusions or other 3D elements`, () => {
    let ast: Program
    let theMap: ReturnType<typeof createArtifactGraph>
    it(`setup`, () => {
      // putting this logic in here because describe blocks runs before beforeAll has finished
      const {
        orderedCommands,
        responseMap,
        ast: _ast,
      } = getCommands('exampleCodeNo3D')
      ast = _ast
      theMap = createArtifactGraph({ orderedCommands, responseMap, ast })
    })

    it('there should be two planes, one for each sketch path', () => {
      const planes = [...filterArtifacts({ types: ['plane'] }, theMap)].map(
        (plane) => expandPlane(plane[1], theMap)
      )
      expect(planes).toHaveLength(2)
      planes.forEach((path) => {
        expect(path.type).toBe('plane')
      })
    })
    it('there should be two paths, one on each plane', () => {
      const paths = [...filterArtifacts({ types: ['path'] }, theMap)].map(
        (path) => expandPath(path[1], theMap)
      )
      expect(paths).toHaveLength(2)
      paths.forEach((path) => {
        if (err(path)) throw path
        expect(path.type).toBe('path')
      })
    })

    it(`there should be 1 solid2D, just for the first closed path`, () => {
      const solid2Ds = [...filterArtifacts({ types: ['solid2D'] }, theMap)]
      expect(solid2Ds).toHaveLength(1)
    })

    it('there should be no extrusions', () => {
      const extrusions = [...filterArtifacts({ types: ['sweep'] }, theMap)].map(
        (extrusion) => expandSweep(extrusion[1], theMap)
      )
      expect(extrusions).toHaveLength(0)
    })

    it('there should be 8 segments, 4 + 1 (close) from the first sketch and 3 from the second', () => {
      const segments = [...filterArtifacts({ types: ['segment'] }, theMap)].map(
        (segment) => expandSegment(segment[1], theMap)
      )
      expect(segments).toHaveLength(8)
    })

    it('screenshot graph', async () => {
      // Ostensibly this takes a screen shot of the graph of the artifactGraph
      // but it's it also tests that all of the id links are correct because if one
      // of the edges refers to a non-existent node, the graph will throw.
      // further more we can check that each edge is bi-directional, if it's not
      // by checking the arrow heads going both ways, on the graph.
      await GraphTheGraph(theMap, 2000, 2000, 'exampleCodeNo3D.png')
    }, 20000)
  })
})

describe('capture graph of sketchOnFaceOnFace...', () => {
  describe('code with an extrusion, fillet and sketch of face:', () => {
    let ast: Program
    let theMap: ReturnType<typeof createArtifactGraph>
    it('setup', async () => {
      // putting this logic in here because describe blocks runs before beforeAll has finished
      const {
        orderedCommands,
        responseMap,
        ast: _ast,
      } = getCommands('sketchOnFaceOnFaceEtc')
      ast = _ast
      theMap = createArtifactGraph({ orderedCommands, responseMap, ast })

      // Ostensibly this takes a screen shot of the graph of the artifactGraph
      // but it's it also tests that all of the id links are correct because if one
      // of the edges refers to a non-existent node, the graph will throw.
      // further more we can check that each edge is bi-directional, if it's not
      // by checking the arrow heads going both ways, on the graph.
      await GraphTheGraph(theMap, 3000, 3000, 'sketchOnFaceOnFaceEtc.png')
    }, 20000)
  })
})

function getCommands(codeKey: CodeKey): CacheShape[CodeKey] & { ast: Program } {
  const ast = assertParse(codeKey)
  const file = fs.readFileSync(fullPath, 'utf-8')
  const parsed: CacheShape = JSON.parse(file)
  // these either already exist from the last run, or were created in
  const orderedCommands = parsed[codeKey].orderedCommands
  const responseMap = parsed[codeKey].responseMap
  return {
    orderedCommands,
    responseMap,
    ast,
  }
}

async function GraphTheGraph(
  theMap: ArtifactGraph,
  sizeX: number,
  sizeY: number,
  imageName: string
) {
  const nodes: Array<{ id: string; label: string }> = []
  const edges: Array<{ source: string; target: string; label: string }> = []
  let index = 0
  for (const [commandId, artifact] of theMap) {
    nodes.push({
      id: commandId,
      label: `${artifact.type}-${index++}`,
    })
    Object.entries(artifact).forEach(([propName, value]) => {
      if (
        propName === 'type' ||
        propName === 'codeRef' ||
        propName === 'subType' ||
        propName === 'id'
      )
        return
      if (Array.isArray(value))
        value.forEach((v) => {
          v && edges.push({ source: commandId, target: v, label: propName })
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
    const sourceNode = nodes.find(
      (node: any) => node.id === (edge as any).source.id
    )
    const targetNode = nodes.find(
      (node: any) => node.id === (edge as any).target.id
    )

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
  await element.screenshot({
    path: `./e2e/playwright/temp3.png`,
  })

  await browser.close()

  const originalImgPath = path.resolve(
    `./src/lang/std/artifactMapGraphs/${imageName}`
  )
  // chop the top 30 pixels off the image
  const originalImgExists = fs.existsSync(originalImgPath)
  const originalImg = originalImgExists
    ? PNG.sync.read(fs.readFileSync(originalImgPath))
    : null
  // const img1Data = new Uint8Array(img1.data)
  // const img1DataChopped = img1Data.slice(30 * img1.width * 4)
  // img1.data = Buffer.from(img1DataChopped)

  const newImagePath = path.resolve('./e2e/playwright/temp3.png')
  const newImage = PNG.sync.read(fs.readFileSync(newImagePath))
  const newImageData = new Uint8Array(newImage.data)
  const newImageDataChopped = newImageData.slice(30 * newImage.width * 4)
  newImage.data = Buffer.from(newImageDataChopped)

  const { width, height } = originalImg ?? newImage
  const diff = new PNG({ width, height })

  const imageSizeDifferent = originalImg?.data.length !== newImage.data.length
  let numDiffPixels = 0
  if (!imageSizeDifferent) {
    numDiffPixels = pixelmatch(
      originalImg.data,
      newImage.data,
      diff.data,
      width,
      height,
      {
        threshold: 0.1,
      }
    )
  }

  if (numDiffPixels > 10 || imageSizeDifferent) {
    console.warn('numDiffPixels', numDiffPixels)
    // write file out to final place
    fs.writeFileSync(
      `src/lang/std/artifactMapGraphs/${imageName}`,
      PNG.sync.write(newImage)
    )
  }
}

describe('testing getArtifactsToUpdate', () => {
  it('should return an array of artifacts to update', () => {
    const { orderedCommands, responseMap, ast } = getCommands('exampleCode1')
    const map = createArtifactGraph({ orderedCommands, responseMap, ast })
    const getArtifact = (id: string) => map.get(id)
    const currentPlaneId = 'UUID-1'
    const getUpdateObjects = (type: Models['ModelingCmd_type']['type']) => {
      const artifactsToUpdate = getArtifactsToUpdate({
        orderedCommand: orderedCommands.find(
          (a) =>
            a.command.type === 'modeling_cmd_req' && a.command.cmd.type === type
        )!,
        responseMap,
        getArtifact,
        currentPlaneId,
        ast,
      })
      return artifactsToUpdate.map(({ artifact }) => artifact)
    }
    expect(getUpdateObjects('start_path')).toEqual([
      {
        type: 'path',
        segIds: [],
        id: expect.any(String),
        planeId: 'UUID-1',
        sweepId: '',
        codeRef: {
          pathToNode: [['body', '']],
          range: [37, 64, 0],
        },
      },
    ])
    expect(getUpdateObjects('extrude')).toEqual([
      {
        type: 'sweep',
        subType: 'extrusion',
        pathId: expect.any(String),
        id: expect.any(String),
        surfaceIds: [],
        edgeIds: [],
        codeRef: {
          range: [231, 254, 0],
          pathToNode: [['body', '']],
        },
      },
      {
        type: 'path',
        id: expect.any(String),
        segIds: expect.any(Array),
        planeId: expect.any(String),
        sweepId: expect.any(String),
        codeRef: {
          range: [37, 64, 0],
          pathToNode: [['body', '']],
        },
        solid2dId: expect.any(String),
      },
    ])
    expect(getUpdateObjects('extend_path')).toEqual([
      {
        type: 'segment',
        id: expect.any(String),
        pathId: expect.any(String),
        surfaceId: '',
        edgeIds: [],
        codeRef: {
          range: [70, 86, 0],
          pathToNode: [['body', '']],
        },
      },
      {
        type: 'path',
        id: expect.any(String),
        segIds: expect.any(Array),
        planeId: expect.any(String),
        sweepId: expect.any(String),
        codeRef: {
          range: [37, 64, 0],
          pathToNode: [['body', '']],
        },
        solid2dId: expect.any(String),
      },
    ])
    expect(getUpdateObjects('solid3d_fillet_edge')).toEqual([
      {
        type: 'edgeCut',
        subType: 'fillet',
        id: expect.any(String),
        consumedEdgeId: expect.any(String),
        edgeIds: [],
        surfaceId: '',
        codeRef: {
          range: [260, 299, 0],
          pathToNode: [['body', '']],
        },
      },
      {
        type: 'segment',
        id: expect.any(String),
        pathId: expect.any(String),
        surfaceId: expect.any(String),
        edgeIds: expect.any(Array),
        codeRef: {
          range: [92, 119, 0],
          pathToNode: [['body', '']],
        },
        edgeCutId: expect.any(String),
      },
    ])
    expect(getUpdateObjects('solid3d_get_extrusion_face_info')).toEqual([
      {
        type: 'wall',
        id: expect.any(String),
        segId: expect.any(String),
        edgeCutEdgeIds: [],
        sweepId: expect.any(String),
        pathIds: [],
      },
      {
        type: 'segment',
        id: expect.any(String),
        pathId: expect.any(String),
        surfaceId: expect.any(String),
        edgeIds: expect.any(Array),
        codeRef: {
          range: [156, 203, 0],
          pathToNode: [['body', '']],
        },
      },
      {
        type: 'sweep',
        subType: 'extrusion',
        id: expect.any(String),
        pathId: expect.any(String),
        surfaceIds: expect.any(Array),
        edgeIds: expect.any(Array),
        codeRef: {
          range: [231, 254, 0],
          pathToNode: [['body', '']],
        },
      },
      {
        type: 'wall',
        id: expect.any(String),
        segId: expect.any(String),
        edgeCutEdgeIds: [],
        sweepId: expect.any(String),
        pathIds: [],
      },
      {
        type: 'segment',
        id: expect.any(String),
        pathId: expect.any(String),
        surfaceId: expect.any(String),
        edgeIds: expect.any(Array),
        codeRef: {
          range: [125, 150, 0],
          pathToNode: [['body', '']],
        },
      },
      {
        type: 'sweep',
        subType: 'extrusion',
        id: expect.any(String),
        pathId: expect.any(String),
        surfaceIds: expect.any(Array),
        edgeIds: expect.any(Array),
        codeRef: {
          range: [231, 254, 0],
          pathToNode: [['body', '']],
        },
      },
      {
        type: 'wall',
        id: expect.any(String),
        segId: expect.any(String),
        edgeCutEdgeIds: [],
        sweepId: expect.any(String),
        pathIds: [],
      },
      {
        type: 'segment',
        id: expect.any(String),
        pathId: expect.any(String),
        surfaceId: expect.any(String),
        edgeIds: expect.any(Array),
        codeRef: {
          range: [92, 119, 0],
          pathToNode: [['body', '']],
        },
        edgeCutId: expect.any(String),
      },
      {
        type: 'sweep',
        subType: 'extrusion',
        id: expect.any(String),
        pathId: expect.any(String),
        surfaceIds: expect.any(Array),
        edgeIds: expect.any(Array),
        codeRef: {
          range: [231, 254, 0],
          pathToNode: [['body', '']],
        },
      },
      {
        type: 'wall',
        id: expect.any(String),
        segId: expect.any(String),
        edgeCutEdgeIds: [],
        sweepId: expect.any(String),
        pathIds: [],
      },
      {
        type: 'segment',
        id: expect.any(String),
        pathId: expect.any(String),
        surfaceId: expect.any(String),
        edgeIds: expect.any(Array),
        codeRef: {
          range: [70, 86, 0],
          pathToNode: [['body', '']],
        },
      },
      {
        type: 'sweep',
        subType: 'extrusion',
        id: expect.any(String),
        pathId: expect.any(String),
        surfaceIds: expect.any(Array),
        edgeIds: expect.any(Array),
        codeRef: {
          range: [231, 254, 0],
          pathToNode: [['body', '']],
        },
      },
      {
        type: 'cap',
        subType: 'start',
        id: expect.any(String),
        edgeCutEdgeIds: [],
        sweepId: expect.any(String),
        pathIds: [],
      },
      {
        type: 'sweep',
        subType: 'extrusion',
        id: expect.any(String),
        pathId: expect.any(String),
        surfaceIds: expect.any(Array),
        edgeIds: expect.any(Array),
        codeRef: {
          range: [231, 254, 0],
          pathToNode: [['body', '']],
        },
      },
      {
        type: 'cap',
        subType: 'end',
        id: expect.any(String),
        edgeCutEdgeIds: [],
        sweepId: expect.any(String),
        pathIds: [],
      },
      {
        type: 'sweep',
        subType: 'extrusion',
        id: expect.any(String),
        pathId: expect.any(String),
        surfaceIds: expect.any(Array),
        edgeIds: expect.any(Array),
        codeRef: {
          range: [231, 254, 0],
          pathToNode: [['body', '']],
        },
      },
    ])
  })
})
