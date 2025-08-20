// wsReasoning.ts
// Logs every frame with the async-op `id`, closes on {"type":"end_of_stream"}

import { withWebSocketURL } from '@src/lib/withBaseURL'

export function connectReasoningStream(
  token: string,
  id: string,
  events: {
    on: {
      open?: () => void
      message: (msg: any) => void
      close?: () => void
      error?: (e: Event) => void
    }
  }
): void {
  const url = withWebSocketURL('').replace(
    '/ws/modeling/commands',
    `/ws/ml/reasoning/${id}`
  )
  const ws = new WebSocket(url)
  const authMessage = {
    type: 'headers',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }

  let i = 0
  const fakeShit = [
    {
      reasoning: {
        type: 'text',
        content: '🔍 Retrieving relevant KCL code examples...',
      },
    },
    {
      reasoning: {
        type: 'kcl_code_examples',
        content:
          "color-cube\n\nmain.kcl:\n```\n// Color Cube\n// This is a color cube centered about the origin. It is used to help determine orientation in the scene.\n\n// Set units\n@settings(defaultLengthUnit = mm, kclVersion = 1.0)\n\n// Parameters referenced in drawRectangle\nsize = 100\nhalfSize = size / 2\nextrudeLength = 1.0\nmetalConstant = 50\nroughnessConstant = 50\n\n// Create planes for 6 sides of a cube\nbluePlane = offsetPlane(XY, offset = halfSize)\nyellowPlane = offsetPlane(XY, offset = -halfSize)\ngreenPlane = offsetPlane(XZ, offset = -halfSize)\npurplePlane = offsetPlane(-XZ, offset = -halfSize)\nredPlane = offsetPlane(YZ, offset = halfSize - extrudeLength)\ntealPlane = offsetPlane(YZ, offset = -halfSize)\n\n// Sketch a rectangle centered at the origin of the profile\nfn sketchRectangle(profile, color) {\n  return profile\n    |> startProfile(at = [-halfSize, halfSize])\n    |> angledLine(angle = 0, length = size, tag = $rectangleSegmentA001)\n    |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = size, tag = $rectangleSegmentB001)\n    |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $rectangleSegmentC001)\n    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])\n    |> close()\n    |> extrude(length = extrudeLength)\n    |> appearance(color = color, metalness = metalConstant, roughness = roughnessConstant)\n}\n\n// Sketch each side of the cube\nsketchRectangle(profile = bluePlane, color = '#0000FF')\nsketchRectangle(profile = yellowPlane, color = '#FFFF00')\nsketchRectangle(profile = greenPlane, color = '#00FF00')\nsketchRectangle(profile = redPlane, color = '#FF0000')\nsketchRectangle(profile = tealPlane, color = '#00FFFF')\nsketchRectangle(profile = purplePlane, color = '#FF00FF')\n\n```\n\n---\n\nparametric-slab\n\nmain.kcl:\n```\n// Parametric Slab\n// A foundation slab measuring 130mm x 130mm x 4mm. Centered on this foundation, deboss a grid of squares 2mm. Each square measures 9mm x 9mm. Space the squares evenly so the outermost dimensions of the whole grid are 123mm x 123 mm.\n\n// Set units in millimeters (mm)\n@settings(defaultLengthUnit = mm)\n\n// Define the dimensions of the foundation slab\nfoundationLength = 130\nfoundationWidth = 130\nfoundationDepth = 4\n\n// Define the dimensions of a single grid square\ngridLength = 9\ngridDepth = 2\n\n// Define the max dimensions of the grid\nmaxGridLength = 123\nmaxGridWidth = 123\n\n// Ensure the defined parameters are valid\nassert(maxGridLength, isLessThan = foundationLength, error = \"maxGridLength must be less than foundationLength\")\nassert(maxGridWidth, isLessThan = foundationWidth, error = \"maxGridLength must be less than foundationWidth\")\n\n// Calculate the number of squares in each direction\nnumSquaresLength = floor(maxGridLength / gridLength)\nnumSquaresWidth = floor(maxGridWidth / gridLength)\n\n// Create a sketch for the foundation\nfoundationSketch = startSketchOn(XY)\n\n// Create the foundation profile\nfoundationProfile = startProfile(foundationSketch, at = [-foundationLength / 2, -foundationWidth / 2])\n  |> xLine(length = foundationLength)\n  |> yLine(length = foundationWidth)\n  |> xLine(length = -foundationLength)\n  |> yLine(length = -foundationWidth)\n  |> close()\n\n// Extrude the foundation profile\nfoundation = extrude(foundationProfile, length = foundationDepth)\n\n// Create a sketch on the foundation for the first square\ngridSketch = startSketchOn(foundation, face = END)\n\n// Define the spacing value for the grid\nspacing = rem(maxGridLength, divisor = gridLength)\n\n// Create the profile of the first square\ngridProfile = startProfile(gridSketch, at = [-(numSquaresLength / 2) * gridLength - (gridLength / 2), -(numSquaresLength / 2) * gridLength - (gridLength / 2)])\n  |> xLine(length = gridLength)\n  |> yLine(length = gridLength)\n  |> xLine(length = -gridLength)\n  |> yLine(length = -gridLength)\n  |> close()\n\n// Pattern the grid profile\ngridPattern = patternLinear2d(\n    gridProfile,\n    instances = numSquaresLength,\n    distance = gridLength + spacing / gridLength,\n    axis = [1, 0],\n  )\n  |> patternLinear2d(\n    instances = numSquaresLength,\n    distance = gridLength + spacing / gridLength,\n    axis = [0, 1],\n  )\n\n// Emboss the grid pattern with a negative extrude\ngrid = extrude(gridPattern, length = -gridDepth)\n```\n\n---\n\nequilateral-triangle-120-starting-edge\n\nmain.kcl:\n```\n// Equilateral Triangle (120° Starting Edge)\n// Starts with the first edge angled at 120° from horizontal.\n\n@settings(defaultLengthUnit = mm, kclVersion = 1.0)\n\nsideLength = 100\nequilateralAngle = 60\nthickness = 1\n\ntriangleSketch = startSketchOn(XY)\ntriangleProfile = startProfile(triangleSketch, at = [0, 0])\n  |> angledLine(angle = 180-equilateralAngle, length = sideLength)\n  |> angledLine(angle = 180+equilateralAngle, length = sideLength)\n  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])\n  |> close()\n\n// Extrude the triangle profile to create a 3D shape\ntriangle = extrude(triangleProfile, length = thickness)\n\n```\n\n---\n\nmodular-shelf-grid\n\nmain.kcl:\n```\n// Modular Shelf Grid\n// A parametric, grid-based shelving system for layout prototyping and modular storage design.\n\n\n// This model generates a configurable number of uniform shelf modules,\n// stacked in a grid defined by row and column counts.\n// Each module is:\n// - A rectangular box composed of two vertical side panels and two horizontal shelves\n// - Open at the front for accessible storage\n// All dimensions and counts are parametric, enabling rapid iteration\n// for uses such as built-ins, modular wall storage, or retail shelving.\n\n\n\n\n@settings(defaultLengthUnit = m, kclVersion = 1.0)\n\ncolumnCount = 5 // number of shelf modules in horizontal direction (X axis)\nrowCount = 3 // number of shelf modules in vertical direction (Z axis)\n\n\n// --- Module Dimensions ---\nunitWidth = 0.4 // external width of each module\nunitHeight = 0.5 // external height of each module\nunitDepth = 0.4 // depth from front to back\n\n\n// --- Geometry Parameters ---\npanelThickness = 0.02 // thickness for side walls and shelves\nsidePanelOffset = unitWidth - panelThickness // spacing between left and right panels\n\n\n// --- Shelf Geometry ---\nshelfThickness = panelThickness // same as panel thickness\nshelfWidth = unitWidth - (panelThickness * 2) // fits between side panels\nshelfDepth = unitDepth // full shelf depth\nshelfSpacing = unitHeight - shelfThickness // position of top shelf above bottom\n\n\n// --- Reference Plane ---\nbasePlane = startSketchOn(XY)\n\n// --- Side Panels ---\n// Left and right vertical panels forming module sides.\nsidePanelProfile = startProfile(basePlane, at = [-unitWidth / 2, 0])\n  |> yLine(length = -unitDepth)\n  |> xLine(length = panelThickness)\n  |> yLine(length = unitDepth)\n  |> close()\n  |> patternLinear2d(\n       %,\n       instances = 2,\n       distance = sidePanelOffset,\n       axis = [1, 0],\n     )\nsidePanels = extrude(sidePanelProfile, length = unitHeight)\n\n// --- Shelf Boards ---\n// Two shelves: one at the bottom, one at the top of each module.\nfirstShelfSketch = startSketchOn(basePlane)\nfirstShelfProfile = startProfile(firstShelfSketch, at = [-shelfWidth / 2, 0])\n  |> yLine(length = -shelfDepth)\n  |> xLine(length = shelfWidth)\n  |> yLine(length = shelfDepth)\n  |> close()\nfirstShelf = extrude(firstShelfProfile, length = shelfThickness)\n\n// Stack two shelf boards inside the unit (bottom and top)\nshelves = patternLinear3d(\n  firstShelf,\n  instances = 2,\n  distance = shelfSpacing,\n  axis = [0, 0, 1],\n)\n\n// --- Grid of Shelf Modules ---\n// Repeats the basic shelf module (side panels + two shelves)\n// in both horizontal and vertical directions to form a full grid.\n\n\nmodularShelfArray = patternLinear3d(\n       [sidePanels, shelves],\n       instances = columnCount,\n       distance = unitWidth,\n       axis = [1, 0, 0],\n     )\n  |> patternLinear3d(\n       %,\n       instances = rowCount,\n       distance = unitHeight,\n       axis = [0, 0, 1],\n     )\n\n```",
      },
    },
    { reasoning: { type: 'text', content: '📝 Generating a design plan...' } },
    {
      reasoning: {
        type: 'feature_tree_outline',
        content:
          '1. Start a new sketch on the XY plane.\n2. Create a square profile with side length 10 units.\n3. Extrude the square profile to a height of 13 units to form a cube.',
      },
    },
    { reasoning: { type: 'text', content: '📚 Reading KCL documentation...' } },
    {
      reasoning: {
        type: 'kcl_docs',
        content:
          '# KCL API Reference\n\nKCL is a programming language for defining precise 2D sketches and 3D models in a CAD environment.\n\n## Functions\n\nWe have support for defining your own functions. Functions can take in any\ntype of argument. Below is an example of the syntax:\n\n```\nfn myFn(x) {\n  return x\n}\n```\n\nAs you can see above `myFn` just returns whatever it is given.\n\nKCL uses keyword arguments:\n\n```\n// If you declare a function like this\nfn add(left, right) {\n  return left + right\n}\n\n// You can call it like this:\ntotal = add(left = 1, right = 2)\n```\n\nFunctions can also declare one *unlabeled* arg. If you do want to declare an unlabeled arg, it must\nbe the first arg declared.\n\n```\n// The @ indicates an argument is used without a label.\n// Note that only the first argument can use @.\nfn increment(@x) {\n  return x + 1\n}\n\nfn add(@x, delta) {\n  return x + delta\n}\n\ntwo = increment(1)\nthree = add(1, delta = 2)\n```\n\n## Pipelines\n\nIt can be hard to read repeated function calls, because of all the nested brackets.\n\n```norun\ni = 1\nx = h(g(f(i)))\n```\n\nYou can make this easier to read by breaking it into many declarations, but that is a bit annoying.\n\n```norun\ni  = 1\nx0 = f(i)\nx1 = g(x0)\nx  = h(x1)\n```\n\nInstead, you can use the pipeline operator (`|>`) to simplify this.\n\nBasically, `x |> f(%)` is a shorthand for `f(x)`. The left-hand side of the `|>` gets put into\nthe `%` in the right-hand side.\n\nSo, this means `x |> f(%) |> g(%)` is shorthand for `g(f(x))`. The code example above, with its\nsomewhat-clunky `x0` and `x1` constants could be rewritten as\n\n```norun\ni = 1\nx = i\n  |> f(%)\n  |> g(%)\n  |> h(%)\n```\n\nThis helps keep your code neat and avoid unnecessary declarations.\n\n## Pipelines and keyword arguments\n\nSay you have a long pipeline of sketch functions, like this:\n\n```kcl\nstartSketchOn(XZ)\n  |> startProfile(at = [0, 0])\n  |> line(%, end = [3, 4])\n  |> line(%, end = [10, 10])\n  |> line(%, end = [-13, -14])\n  |> close(%)\n```\n\nIn this example, each function call outputs a sketch, and it gets put into the next function call via\nthe `%`, into the first (unlabeled) argument.\n\nIf a function call uses an unlabeled first parameter, it will default to `%` if it\'s not given. This\nmeans that `|> line(%, end = [3, 4])` and `|> line(end = [3, 4])` are equivalent! So the above\ncould be rewritten as \n\n```kcl\nstartSketchOn(XZ)\n  |> startProfile(at = [0, 0])\n  |> line(end = [3, 4])\n  |> line(end = [10, 10])\n  |> line(end = [-13, -14])\n  |> close()\n```\n\n## Values and types\n\n`KCL` defines the following types and keywords the language.\n\nAll these types can be nested in various forms where nesting applies. Like\narrays can hold objects and vice versa.\n\n## Constant declaration\n\nConstants are defined with a name and a value, like so:\n\n```kcl\nmyBool = false\n```\n\nCurrently you cannot redeclare a constant.\n\n\n## Objects\n\nAn object is defined with `{}` braces. Here is an example object:\n\n```kcl\nmyObj = { a = 0, b = "thing" }\n```\n\nTo get the property of an object, you can call `myObj.a`, which in the above\nexample returns 0.\n\n## `ImportedGeometry`\n\nUsing `import` you can import geometry defined using other CAD software. In KCL,\nthese objects have type `ImportedGeometry` and can mostly be treated like any\nother solid (they can be rotated, scaled, etc.), although there is no access to\ntheir internal components. See the [modules and imports docs](modules) for more\ndetail on importing geometry.\n\n\n## Tags\n\nTags are used to give a name (tag) to a specific path.\n\n### Tag declarations - `TagDecl`\n\nThe syntax for declaring a tag is `$myTag` you would use it in the following\nway:\n\n```kcl\nstartSketchOn(XZ)\n  |> startProfile(at = [0, 0])\n  |> angledLine(angle = 0, length = 191.26, tag = $rectangleSegmentA001)\n  |> angledLine(\n       angle = segAng(rectangleSegmentA001) - 90,\n       length = 196.99,\n       tag = $rectangleSegmentB001,\n     )\n  |> angledLine(\n       angle = segAng(rectangleSegmentA001),\n       length = -segLen(rectangleSegmentA001),\n       tag = $rectangleSegmentC001,\n     )\n  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])\n  |> close()\n```\n\nWhen a function requires declaring a new tag (using the `$` syntax), the argument has type [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl).\n\n### Tag identifiers\n\nA tag created using a tag declarator can be used by writing its name without the `$`, e.g., `myTag`.\nWhere necessary to disambiguate from tag declarations, we call these tag identifiers.\n\nIn the example above we use the tag identifier `rectangleSegmentA001` to get the angle of the segment\nusing `segAng(rectangleSegmentA001)`.\n\nTags can identify either an edge or face of a solid, or a line or other edge of a sketch. Functions\nwhich take a tag identifier as an argument will use either',
      },
    },
    { reasoning: { type: 'text', content: '💻 Generating KCL code...' } },
    {
      reasoning: {
        type: 'generated_kcl_code',
        code: '@settings(defaultLengthUnit = mm)\n\n// Define the dimensions of the cube\ncubeWidth = 10\ncubeHeight = 10\ncubeDepth = 13\n\n// Create a sketch for the base of the cube\ncubeSketch = startSketchOn(XY)\n\n// Create the profile of the cube\ncubeProfile = startProfile(cubeSketch, at = [-cubeWidth / 2, -cubeHeight / 2])\n  |> xLine(length = cubeWidth)\n  |> yLine(length = cubeHeight)\n  |> xLine(length = -cubeWidth)\n  |> yLine(length = -cubeHeight)\n  |> close()\n\n// Extrude the profile to create the 3D cube\ncube = extrude(cubeProfile, length = cubeDepth)',
      },
    },
    { reasoning: { type: 'text', content: '📟 Checking KCL code...' } },
    {
      tool_output: {
        result: {
          type: 'text_to_cad',
          outputs: {
            'main.kcl':
              '/*\nGenerated by Text-to-CAD:\nMake a 10x10x13 cube\n*/\n@settings(defaultLengthUnit = mm)\n\n// Define the dimensions of the cube\ncubeWidth = 10\ncubeHeight = 10\ncubeDepth = 13\n\n// Create a sketch for the base of the cube\ncubeSketch = startSketchOn(XY)\n\n// Create the profile of the cube\ncubeProfile = startProfile(cubeSketch, at = [-cubeWidth / 2, -cubeHeight / 2])\n  |> xLine(length = cubeWidth)\n  |> yLine(length = cubeHeight)\n  |> xLine(length = -cubeWidth)\n  |> yLine(length = -cubeHeight)\n  |> close()\n\n// Extrude the profile to create the 3D cube\ncube = extrude(cubeProfile, length = cubeDepth)',
          },
          status_code: 201,
        },
      },
    },
  ]
  const nextFakeShit = () => {
    setTimeout(() => {
      const f = fakeShit[i]
      i += 1
      events.on.message(f)
      nextFakeShit()
    }, Math.random() * 2000)
  }

  ws.addEventListener('open', () => {
    console.log(`[${id}] open ${url}`)
    ws.send(JSON.stringify(authMessage)) // 🔸 send immediately
    nextFakeShit()
    console.log(`[${id}] →`, authMessage)
    events.on.open?.()
  })

  ws.addEventListener('message', (ev) => {
    console.log(`[${id}] raw`, ev.data)

    let msg: unknown
    try {
      msg = JSON.parse(ev.data as string)
    } catch {
      console.error(`[${id}] JSON parse error`, ev.data)
      return // non-JSON frame
    }

    // If we fail to parse no message will be rendered / visualized.
    // Technically should never happen, but mistakes happen between client/server.
    events.on.message(msg as any)

    if ('error' in (msg as any)) {
      ws.send(JSON.stringify(authMessage)) // 🔸 send immediately
      console.log(`[${id}] →`, authMessage)
    }

    if ('end_of_stream' in (msg as any)) {
      console.log(`[${id}] end_of_stream → closing`)
      ws.close(1000, 'done')
    }
  })

  ws.addEventListener('close', (e) => {
    console.log(`[${id}] close`, e.code, e.reason)
    events.on.close?.()
  })

  ws.addEventListener('error', (e) => {
    console.error(e)
    events.on.error?.(e)
  })
}
