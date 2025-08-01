import {
  type Artifact,
  assertParse,
  type CodeRef,
  type PathToNode,
  type Program,
  recast,
} from '@src/lang/wasm'
import type { Selection, Selections } from '@src/lib/selections'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import {
  addAppearance,
  addClone,
  addRotate,
  addScale,
  addTranslate,
} from '@src/lang/modifyAst/transforms'

async function getAstAndArtifactGraph(code: string) {
  const ast = assertParse(code)
  if (err(ast)) throw ast

  const { artifactGraph } = await enginelessExecutor(ast)
  return { ast, artifactGraph }
}

function createSelectionFromPathArtifact(
  artifacts: (Artifact & { codeRef: CodeRef })[]
): Selections {
  const graphSelections = artifacts.map(
    (artifact) =>
      ({
        codeRef: artifact.codeRef,
        artifact,
      }) as Selection
  )
  return {
    graphSelections,
    otherSelections: [],
  }
}

async function getAstAndSketchSelections(code: string) {
  const { ast, artifactGraph } = await getAstAndArtifactGraph(code)
  const artifacts = [...artifactGraph.values()].filter((a) => a.type === 'path')
  if (artifacts.length === 0) {
    throw new Error('Artifact not found in the graph')
  }
  const sketches = createSelectionFromPathArtifact(artifacts)
  return { artifactGraph, ast, sketches }
}

async function getKclCommandValue(value: string) {
  const result = await stringToKclExpression(value)
  if (err(result) || 'errors' in result) {
    throw new Error(`Couldn't create kcl expression`)
  }

  return result
}

async function runNewAstAndCheckForSweep(ast: Node<Program>) {
  const { artifactGraph } = await enginelessExecutor(ast)
  const sweepArtifact = artifactGraph.values().find((a) => a.type === 'sweep')
  expect(sweepArtifact).toBeDefined()
}

describe('Testing addTranslate', () => {
  async function runAddTranslateTest(code: string) {
    const {
      artifactGraph,
      ast,
      sketches: objects,
    } = await getAstAndSketchSelections(code)
    const result = addTranslate({
      ast,
      artifactGraph,
      objects,
      x: await getKclCommandValue('1'),
      y: await getKclCommandValue('2'),
      z: await getKclCommandValue('3'),
      global: true,
    })
    if (err(result)) throw result
    await runNewAstAndCheckForSweep(result.modifiedAst)
    return recast(result.modifiedAst)
  }

  it('should add a standalone translate call on sweep selection', async () => {
    const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)`
    const expectedNewLine = `translate(
  extrude001,
  x = 1,
  y = 2,
  z = 3,
  global = true,
)`
    const newCode = await runAddTranslateTest(code)
    expect(newCode).toContain(code + '\n' + expectedNewLine)
  })

  it('should push a call in pipe if selection was in variable-less pipe', async () => {
    const code = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)`
    const expectedNewLine = `  |> translate(
       x = 1,
       y = 2,
       z = 3,
       global = true,
     )`
    const newCode = await runAddTranslateTest(code)
    expect(newCode).toContain(code + '\n' + expectedNewLine)
  })

  async function runEditTranslateTest(code: string, nodeToEdit: PathToNode) {
    const {
      artifactGraph,
      ast,
      sketches: objects,
    } = await getAstAndSketchSelections(code)
    const result = addTranslate({
      ast,
      artifactGraph,
      objects,
      x: await getKclCommandValue('4'),
      y: await getKclCommandValue('5'),
      z: await getKclCommandValue('6'),
      global: false,
      nodeToEdit,
    })
    if (err(result)) throw result
    await runNewAstAndCheckForSweep(result.modifiedAst)
    return recast(result.modifiedAst)
  }

  it('should edit a call with variable if og selection was a variable sweep', async () => {
    const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
translate(
  extrude001,
  x = 1,
  y = 2,
  z = 3,
  global = true,
)`
    const expectedNewCode = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
translate(
  extrude001,
  x = 4,
  y = 5,
  z = 6,
)`
    const nodeToEdit: PathToNode = [
      ['body', ''],
      [3, 'index'],
      ['expression', 'ExpressionStatement'],
    ]
    const newCode = await runEditTranslateTest(code, nodeToEdit)
    expect(newCode).toContain(expectedNewCode)
  })

  it('should edit a call in pipe if og selection was in pipe', async () => {
    const code = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)
  |> translate(
        x = 1,
        y = 2,
        z = 3,
        global = true,
    )`
    const expectedNewCode = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)
  |> translate(x = 4, y = 5, z = 6)
`
    const nodeToEdit: PathToNode = [
      ['body', ''],
      [0, 'index'],
      ['expression', 'ExpressionStatement'],
      ['body', 'PipeExpression'],
      [3, 'index'],
    ]
    const newCode = await runEditTranslateTest(code, nodeToEdit)
    expect(newCode).toContain(expectedNewCode)
  })
})

describe('Testing addScale', () => {
  async function runAddScaleTest(code: string) {
    const {
      artifactGraph,
      ast,
      sketches: objects,
    } = await getAstAndSketchSelections(code)
    const result = addScale({
      ast,
      artifactGraph,
      objects,
      x: await getKclCommandValue('1'),
      y: await getKclCommandValue('2'),
      z: await getKclCommandValue('3'),
      global: true,
    })
    if (err(result)) throw result
    await runNewAstAndCheckForSweep(result.modifiedAst)
    return recast(result.modifiedAst)
  }

  it('should add a standalone call on sweep selection', async () => {
    const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)`
    const expectedNewLine = `scale(
  extrude001,
  x = 1,
  y = 2,
  z = 3,
  global = true,
)`
    const newCode = await runAddScaleTest(code)
    expect(newCode).toContain(code + '\n' + expectedNewLine)
  })

  it('should push a call in pipe if selection was in variable-less pipe', async () => {
    const code = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)`
    const expectedNewLine = `  |> scale(
       x = 1,
       y = 2,
       z = 3,
       global = true,
     )`
    const newCode = await runAddScaleTest(code)
    expect(newCode).toContain(code + '\n' + expectedNewLine)
  })

  async function runEditScaleTest(code: string, nodeToEdit: PathToNode) {
    const {
      artifactGraph,
      ast,
      sketches: objects,
    } = await getAstAndSketchSelections(code)
    const result = addScale({
      ast,
      artifactGraph,
      objects,
      x: await getKclCommandValue('4'),
      y: await getKclCommandValue('5'),
      z: await getKclCommandValue('6'),
      global: false,
      nodeToEdit,
    })
    if (err(result)) throw result
    await runNewAstAndCheckForSweep(result.modifiedAst)
    return recast(result.modifiedAst)
  }

  it('should edit a scale call with variable if og selection was a variable sweep', async () => {
    const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
scale(
  extrude001,
  x = 1,
  y = 2,
  z = 3,
  global = true,
)`
    const expectedNewCode = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
scale(
  extrude001,
  x = 4,
  y = 5,
  z = 6,
)`
    const nodeToEdit: PathToNode = [
      ['body', ''],
      [3, 'index'],
      ['expression', 'ExpressionStatement'],
    ]
    const newCode = await runEditScaleTest(code, nodeToEdit)
    expect(newCode).toContain(expectedNewCode)
  })

  it('should edit a call in pipe if og selection was in pipe', async () => {
    const code = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)
  |> scale(
        x = 1,
        y = 2,
        z = 3,
        global = true,
    )`
    const expectedNewCode = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)
  |> scale(x = 4, y = 5, z = 6)
`
    const nodeToEdit: PathToNode = [
      ['body', ''],
      [0, 'index'],
      ['expression', 'ExpressionStatement'],
      ['body', 'PipeExpression'],
      [3, 'index'],
    ]
    const newCode = await runEditScaleTest(code, nodeToEdit)
    expect(newCode).toContain(expectedNewCode)
  })

  // TODO: missing multi-objects test
})

describe('Testing addRotate', () => {
  async function runAddRotateTest(code: string) {
    const {
      artifactGraph,
      ast,
      sketches: objects,
    } = await getAstAndSketchSelections(code)
    const result = addRotate({
      ast,
      artifactGraph,
      objects,
      roll: await getKclCommandValue('10'),
      pitch: await getKclCommandValue('20'),
      yaw: await getKclCommandValue('30'),
      global: true,
    })
    if (err(result)) throw result
    await runNewAstAndCheckForSweep(result.modifiedAst)
    return recast(result.modifiedAst)
  }

  it('should add a standalone call on sweep selection', async () => {
    const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)`
    const expectedNewLine = `rotate(
  extrude001,
  roll = 10,
  pitch = 20,
  yaw = 30,
  global = true,
)`
    const newCode = await runAddRotateTest(code)
    expect(newCode).toContain(code + '\n' + expectedNewLine)
  })

  it('should push a call in pipe if selection was in variable-less pipe', async () => {
    const code = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)`
    const expectedNewLine = `  |> rotate(
       roll = 10,
       pitch = 20,
       yaw = 30,
       global = true,
     )`
    const newCode = await runAddRotateTest(code)
    expect(newCode).toContain(code + '\n' + expectedNewLine)
  })

  async function runEditRotateTest(code: string, nodeToEdit: PathToNode) {
    const {
      artifactGraph,
      ast,
      sketches: objects,
    } = await getAstAndSketchSelections(code)
    const result = addRotate({
      ast,
      artifactGraph,
      objects,
      roll: await getKclCommandValue('40'),
      pitch: await getKclCommandValue('50'),
      yaw: await getKclCommandValue('60'),
      global: false,
      nodeToEdit,
    })
    if (err(result)) throw result
    await runNewAstAndCheckForSweep(result.modifiedAst)
    return recast(result.modifiedAst)
  }

  it('should edit a call with variable if og selection was a variable sweep', async () => {
    const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
rotate(
  extrude001,
  roll = 4,
  pitch = 5,
  yaw = 6,
  global = true,
)`
    const expectedNewCode = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
rotate(
  extrude001,
  roll = 40,
  pitch = 50,
  yaw = 60,
)`
    const nodeToEdit: PathToNode = [
      ['body', ''],
      [3, 'index'],
      ['expression', 'ExpressionStatement'],
    ]
    const newCode = await runEditRotateTest(code, nodeToEdit)
    expect(newCode).toContain(expectedNewCode)
  })

  it('should edit a call in pipe if og selection was in pipe', async () => {
    const code = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)
  |> rotate(
        roll = 1,
        pitch = 2,
        yaw = 3,
        global = true,
    )`
    const expectedNewCode = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)
  |> rotate(roll = 40, pitch = 50, yaw = 60)
`
    const nodeToEdit: PathToNode = [
      ['body', ''],
      [0, 'index'],
      ['expression', 'ExpressionStatement'],
      ['body', 'PipeExpression'],
      [3, 'index'],
    ]
    const newCode = await runEditRotateTest(code, nodeToEdit)
    expect(newCode).toContain(expectedNewCode)
  })

  // TODO: missing multi-objects test
})

describe('Testing addClone', () => {
  async function runAddCloneTest(code: string) {
    const {
      artifactGraph,
      ast,
      sketches: objects,
    } = await getAstAndSketchSelections(code)
    const result = addClone({
      ast,
      artifactGraph,
      objects,
      variableName: 'yoyoyo',
    })
    if (err(result)) throw result
    await runNewAstAndCheckForSweep(result.modifiedAst)
    return recast(result.modifiedAst)
  }

  it('should add a standalone call on sweep selection', async () => {
    const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)`
    const expectedNewLine = `yoyoyo = clone(extrude001)`
    const newCode = await runAddCloneTest(code)
    expect(newCode).toContain(code + '\n' + expectedNewLine)
  })
})

describe('Testing addAppearance', () => {
  async function runAddAppearanceTest(code: string) {
    const {
      artifactGraph,
      ast,
      sketches: objects,
    } = await getAstAndSketchSelections(code)
    const result = addAppearance({
      ast,
      artifactGraph,
      objects,
      color: '#FF0000',
    })
    if (err(result)) throw result
    await runNewAstAndCheckForSweep(result.modifiedAst)
    return recast(result.modifiedAst)
  }

  const box = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)`
  it('should add a standalone call on sweep selection', async () => {
    const expectedNewLine = `appearance(extrude001, color = '#FF0000')`
    const newCode = await runAddAppearanceTest(box)
    expect(newCode).toContain(box + '\n' + expectedNewLine)
  })

  it('should push a call in pipe if selection was in variable-less pipe', async () => {
    const code = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)`
    const expectedNewLine = `  |> appearance(color = '#FF0000')`
    const newCode = await runAddAppearanceTest(code)
    expect(newCode).toContain(code + '\n' + expectedNewLine)
  })

  it('should add a call with metalness and roughness', async () => {
    const {
      artifactGraph,
      ast,
      sketches: objects,
    } = await getAstAndSketchSelections(box)
    const result = addAppearance({
      ast,
      artifactGraph,
      objects,
      color: '#FF0000',
      metalness: await getKclCommandValue('1'),
      roughness: await getKclCommandValue('2'),
    })
    if (err(result)) throw result
    await runNewAstAndCheckForSweep(result.modifiedAst)
    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(`${box}
appearance(
  extrude001,
  color = '#FF0000',
  metalness = 1,
  roughness = 2,
)`)
  })

  async function runEditAppearanceTest(code: string, nodeToEdit: PathToNode) {
    const {
      artifactGraph,
      ast,
      sketches: objects,
    } = await getAstAndSketchSelections(code)
    const result = addAppearance({
      ast,
      artifactGraph,
      objects,
      color: '#00FF00',
      nodeToEdit,
    })
    if (err(result)) throw result
    await runNewAstAndCheckForSweep(result.modifiedAst)
    return recast(result.modifiedAst)
  }

  it('should edit a call with variable if og selection was a variable sweep', async () => {
    const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
appearance(extrude001, color = '#FF0000')`
    const expectedNewCode = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
appearance(extrude001, color = '#00FF00')`
    const nodeToEdit: PathToNode = [
      ['body', ''],
      [3, 'index'],
      ['expression', 'ExpressionStatement'],
    ]
    const newCode = await runEditAppearanceTest(code, nodeToEdit)
    expect(newCode).toContain(expectedNewCode)
  })

  it('should edit a call in pipe if og selection was in pipe', async () => {
    const code = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)
  |> appearance(color = '#FF0000')`
    const expectedNewCode = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)
  |> appearance(color = '#00FF00')`
    const nodeToEdit: PathToNode = [
      ['body', ''],
      [0, 'index'],
      ['expression', 'ExpressionStatement'],
      ['body', 'PipeExpression'],
      [3, 'index'],
    ]
    const newCode = await runEditAppearanceTest(code, nodeToEdit)
    expect(newCode).toContain(expectedNewCode)
  })

  // TODO: missing multi-objects test
})
