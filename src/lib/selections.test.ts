import { expect } from 'vitest'

import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import type { Artifact } from '@src/lang/std/artifactGraph'
import type { ArtifactGraph, SourceRange } from '@src/lang/wasm'
import { assertParse } from '@src/lang/wasm'
import { initPromise } from '@src/lang/wasmUtils'
import type { ArtifactIndex } from '@src/lib/artifactIndex'
import { buildArtifactIndex } from '@src/lib/artifactIndex'
import type { Selection } from '@src/lib/selections'
import {
  codeToIdSelections,
  findLastRangeStartingBefore,
} from '@src/lib/selections'

beforeAll(async () => {
  await initPromise
})

describe('testing source range to artifact conversion', () => {
  const MY_CODE = `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [105.55, 105.55])
  |> xLine(length = 332.55, tag = $seg01)
  |> yLine(length = -310.12, tag = $seg02)
  |> xLine(length = -373.65)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 500)

sketch002 = startSketchOn(extrude001, face = seg01)
profile002 = startProfile(sketch002, at = [-321.34, 361.76])
  |> line(end = [109.03, -61.79])
  |> line(end = [-124.48, -132.65])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude002 = extrude(profile002, length = 500)
sketch005 = startSketchOn(extrude002, face = END)
profile006 = circle(sketch005, center = [-292.57, 302.55], radius = 25.89)
sketch004 = startSketchOn(extrude001, face = seg02)
profile005 = startProfile(sketch004, at = [36.1, 174.49])
  |> angledLine(angle = 0, length = 22.33, tag = $rectangleSegmentA003)
  |> angledLine(angle = segAng(rectangleSegmentA003) - 90, length = 155.27)
  |> angledLine(angle = segAng(rectangleSegmentA003), length = -segLen(rectangleSegmentA003))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
sketch003 = startSketchOn(extrude001, face = seg02)
profile003 = startProfile(sketch003, at = [-115.59, 439.4])
  |> angledLine(angle = 0, length = 130.08, tag = $rectangleSegmentA002)
  |> angledLine(angle = segAng(rectangleSegmentA002) - 90, length = 123.84)
  |> angledLine(angle = segAng(rectangleSegmentA002), length = -segLen(rectangleSegmentA002))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
profile004 = circle(sketch003, center = [-88.54, 209.41], radius = 42.72)
`
  const ___artifactGraph = new Map([
    [
      '9b6f2a00-d871-5dc9-8912-aef56b59035d',
      {
        type: 'plane',
        id: '9b6f2a00-d871-5dc9-8912-aef56b59035d',
        pathIds: ['a02393ed-4452-5b91-9ee9-4c42db7a50a3'],
        codeRef: {
          range: [12, 29, 0],
          pathToNode: [
            ['body', ''],
            [0, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
          ],
        },
      },
    ],
    [
      'a02393ed-4452-5b91-9ee9-4c42db7a50a3',
      {
        type: 'path',
        id: 'a02393ed-4452-5b91-9ee9-4c42db7a50a3',
        planeId: '9b6f2a00-d871-5dc9-8912-aef56b59035d',
        segIds: [
          '5b1bf38f-6ccc-5d51-a58e-a66fb7e9af9e',
          '2bba5d49-d2a4-56bb-88c8-302a3fe1aca7',
          '0edcccdd-3f57-5e86-84d9-90aac061b21e',
          'f7861c82-8117-5bb5-af9c-be285026b0c6',
          'f124c577-7b49-512d-ad8e-4cc84b2c53ba',
        ],
        sweepId: '0bfb95e2-1eae-560f-96e1-354e1ece4ac2',
        solid2dId: '76214ae9-592c-4e91-bef7-cfbf5530e393',
        codeRef: {
          range: [43, 89, 0],
          pathToNode: [
            ['body', ''],
            [1, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [0, 'index'],
          ],
        },
      },
    ],
    [
      '5b1bf38f-6ccc-5d51-a58e-a66fb7e9af9e',
      {
        type: 'segment',
        id: '5b1bf38f-6ccc-5d51-a58e-a66fb7e9af9e',
        pathId: 'a02393ed-4452-5b91-9ee9-4c42db7a50a3',
        surfaceId: '1b3c0e51-a51b-41d3-ae0a-1c9e0c18b57a',
        edgeIds: [
          'f87a7e1e-a594-4c7d-bb06-e19b76092678',
          'b197cdad-d60f-4e3c-afdd-58e6f1c323f1',
        ],
        codeRef: {
          range: [95, 131, 0],
          pathToNode: [
            ['body', ''],
            [1, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [1, 'index'],
          ],
        },
        commonSurfaceIds: [
          '1b3c0e51-a51b-41d3-ae0a-1c9e0c18b57a',
          'b9e275c1-5147-46f5-af49-b3d762933748',
        ],
      },
    ],
    [
      '2bba5d49-d2a4-56bb-88c8-302a3fe1aca7',
      {
        type: 'segment',
        id: '2bba5d49-d2a4-56bb-88c8-302a3fe1aca7',
        pathId: 'a02393ed-4452-5b91-9ee9-4c42db7a50a3',
        surfaceId: 'c30f705c-f778-48df-8e1d-33f07dcceb90',
        edgeIds: [
          '6ddaad54-f49d-498a-8935-0af5e055f5fd',
          '3315f045-caf3-46d6-9cb5-7b1c658ae562',
        ],
        codeRef: {
          range: [137, 174, 0],
          pathToNode: [
            ['body', ''],
            [1, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [2, 'index'],
          ],
        },
        commonSurfaceIds: [
          'c30f705c-f778-48df-8e1d-33f07dcceb90',
          'b9e275c1-5147-46f5-af49-b3d762933748',
        ],
      },
    ],
    [
      '0edcccdd-3f57-5e86-84d9-90aac061b21e',
      {
        type: 'segment',
        id: '0edcccdd-3f57-5e86-84d9-90aac061b21e',
        pathId: 'a02393ed-4452-5b91-9ee9-4c42db7a50a3',
        surfaceId: '35628e3b-78d6-4de4-a43d-d96220004fe1',
        edgeIds: [
          'feb3eb40-cc3f-4a56-bb97-4a6d31e95d15',
          'b063089b-f929-4fe7-8df6-044f8b469990',
        ],
        codeRef: {
          range: [180, 203, 0],
          pathToNode: [
            ['body', ''],
            [1, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [3, 'index'],
          ],
        },
        commonSurfaceIds: [
          '35628e3b-78d6-4de4-a43d-d96220004fe1',
          'b9e275c1-5147-46f5-af49-b3d762933748',
        ],
      },
    ],
    [
      'f7861c82-8117-5bb5-af9c-be285026b0c6',
      {
        type: 'segment',
        id: 'f7861c82-8117-5bb5-af9c-be285026b0c6',
        pathId: 'a02393ed-4452-5b91-9ee9-4c42db7a50a3',
        surfaceId: '36584687-7151-4406-a51f-f07933ae1695',
        edgeIds: [
          '8ddb1c33-8519-4467-a50f-b3879f47ea03',
          'b197cdad-d60f-4e3c-afdd-58e6f1c323f1',
        ],
        codeRef: {
          range: [209, 265, 0],
          pathToNode: [
            ['body', ''],
            [1, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [4, 'index'],
          ],
        },
        commonSurfaceIds: [
          '36584687-7151-4406-a51f-f07933ae1695',
          'b9e275c1-5147-46f5-af49-b3d762933748',
        ],
      },
    ],
    [
      'f124c577-7b49-512d-ad8e-4cc84b2c53ba',
      {
        type: 'segment',
        id: 'f124c577-7b49-512d-ad8e-4cc84b2c53ba',
        pathId: 'a02393ed-4452-5b91-9ee9-4c42db7a50a3',
        codeRef: {
          range: [271, 278, 0],
          pathToNode: [
            ['body', ''],
            [1, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [5, 'index'],
          ],
        },
      },
    ],
    [
      '76214ae9-592c-4e91-bef7-cfbf5530e393',
      {
        type: 'solid2d',
        id: '76214ae9-592c-4e91-bef7-cfbf5530e393',
        pathId: 'a02393ed-4452-5b91-9ee9-4c42db7a50a3',
      },
    ],
    [
      '0bfb95e2-1eae-560f-96e1-354e1ece4ac2',
      {
        type: 'sweep',
        id: '0bfb95e2-1eae-560f-96e1-354e1ece4ac2',
        subType: 'extrusion',
        pathId: 'a02393ed-4452-5b91-9ee9-4c42db7a50a3',
        surfaceIds: [
          '36584687-7151-4406-a51f-f07933ae1695',
          '35628e3b-78d6-4de4-a43d-d96220004fe1',
          'c30f705c-f778-48df-8e1d-33f07dcceb90',
          '1b3c0e51-a51b-41d3-ae0a-1c9e0c18b57a',
          'b9e275c1-5147-46f5-af49-b3d762933748',
          'f7afc2dd-859c-4b3b-8cac-01fcc13672ab',
        ],
        edgeIds: [
          '8ddb1c33-8519-4467-a50f-b3879f47ea03',
          'b197cdad-d60f-4e3c-afdd-58e6f1c323f1',
          'feb3eb40-cc3f-4a56-bb97-4a6d31e95d15',
          'b063089b-f929-4fe7-8df6-044f8b469990',
          '6ddaad54-f49d-498a-8935-0af5e055f5fd',
          '3315f045-caf3-46d6-9cb5-7b1c658ae562',
          'f87a7e1e-a594-4c7d-bb06-e19b76092678',
        ],
        codeRef: {
          range: [292, 325, 0],
          pathToNode: [
            ['body', ''],
            [2, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
          ],
        },
      },
    ],
    [
      '36584687-7151-4406-a51f-f07933ae1695',
      {
        type: 'wall',
        id: '36584687-7151-4406-a51f-f07933ae1695',
        segId: 'f7861c82-8117-5bb5-af9c-be285026b0c6',
        sweepId: '0bfb95e2-1eae-560f-96e1-354e1ece4ac2',
        faceCodeRef: {
          range: [0, 0, 0],
          pathToNode: [],
        },
        cmdId: '6754a9b3-9b1e-5e6f-b872-7849d82fa323',
      },
    ],
    [
      '35628e3b-78d6-4de4-a43d-d96220004fe1',
      {
        type: 'wall',
        id: '35628e3b-78d6-4de4-a43d-d96220004fe1',
        segId: '0edcccdd-3f57-5e86-84d9-90aac061b21e',
        sweepId: '0bfb95e2-1eae-560f-96e1-354e1ece4ac2',
        faceCodeRef: {
          range: [0, 0, 0],
          pathToNode: [],
        },
        cmdId: '6754a9b3-9b1e-5e6f-b872-7849d82fa323',
      },
    ],
    [
      'c30f705c-f778-48df-8e1d-33f07dcceb90',
      {
        type: 'wall',
        id: 'c30f705c-f778-48df-8e1d-33f07dcceb90',
        segId: '2bba5d49-d2a4-56bb-88c8-302a3fe1aca7',
        sweepId: '0bfb95e2-1eae-560f-96e1-354e1ece4ac2',
        pathIds: [
          '6d22e8ef-40c6-5663-84a7-f974e53c8226',
          '403d6680-758a-5228-9c69-b1cba8437ec1',
          'cbce7813-eaee-59a6-9f30-8a964229c8ee',
        ],
        faceCodeRef: {
          range: [769, 808, 0],
          pathToNode: [],
        },
        cmdId: '6754a9b3-9b1e-5e6f-b872-7849d82fa323',
      },
    ],
    [
      '1b3c0e51-a51b-41d3-ae0a-1c9e0c18b57a',
      {
        type: 'wall',
        id: '1b3c0e51-a51b-41d3-ae0a-1c9e0c18b57a',
        segId: '5b1bf38f-6ccc-5d51-a58e-a66fb7e9af9e',
        sweepId: '0bfb95e2-1eae-560f-96e1-354e1ece4ac2',
        pathIds: ['2d6f6d5f-0e5f-5a4a-b262-2d11f87e411d'],
        faceCodeRef: {
          range: [339, 378, 0],
          pathToNode: [],
        },
        cmdId: '6754a9b3-9b1e-5e6f-b872-7849d82fa323',
      },
    ],
    [
      'b9e275c1-5147-46f5-af49-b3d762933748',
      {
        type: 'cap',
        id: 'b9e275c1-5147-46f5-af49-b3d762933748',
        subType: 'start',
        sweepId: '0bfb95e2-1eae-560f-96e1-354e1ece4ac2',
        faceCodeRef: {
          range: [0, 0, 0],
          pathToNode: [],
        },
        cmdId: '6754a9b3-9b1e-5e6f-b872-7849d82fa323',
      },
    ],
    [
      'f7afc2dd-859c-4b3b-8cac-01fcc13672ab',
      {
        type: 'cap',
        id: 'f7afc2dd-859c-4b3b-8cac-01fcc13672ab',
        subType: 'end',
        sweepId: '0bfb95e2-1eae-560f-96e1-354e1ece4ac2',
        faceCodeRef: {
          range: [0, 0, 0],
          pathToNode: [],
        },
        cmdId: '6754a9b3-9b1e-5e6f-b872-7849d82fa323',
      },
    ],
    [
      '2d6f6d5f-0e5f-5a4a-b262-2d11f87e411d',
      {
        type: 'path',
        id: '2d6f6d5f-0e5f-5a4a-b262-2d11f87e411d',
        planeId: '1b3c0e51-a51b-41d3-ae0a-1c9e0c18b57a',
        segIds: [
          '73b27fd2-22b5-54dd-89c3-2278d82ae319',
          '5aa38d46-878d-5283-991a-bc7c92e01b9d',
          '184c29e4-fcc5-52de-8325-db46e621428a',
          'bad45333-61e7-5c3a-ac4b-4efa333a6b90',
        ],
        sweepId: '513a2eb1-ada0-51b1-83d7-4990db8676dc',
        solid2dId: 'fd13e492-2201-4ac5-b169-82d1b42f8d10',
        codeRef: {
          range: [392, 439, 0],
          pathToNode: [
            ['body', ''],
            [4, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [0, 'index'],
          ],
        },
      },
    ],
    [
      '73b27fd2-22b5-54dd-89c3-2278d82ae319',
      {
        type: 'segment',
        id: '73b27fd2-22b5-54dd-89c3-2278d82ae319',
        pathId: '2d6f6d5f-0e5f-5a4a-b262-2d11f87e411d',
        surfaceId: '02acb19d-cc92-4cae-9e55-d6dbefb78705',
        edgeIds: [
          '3e4b5133-5570-44f8-92c7-b39bd5baaa55',
          '9ed007ff-3149-4a72-9b43-04f74c38a171',
        ],
        codeRef: {
          range: [445, 473, 0],
          pathToNode: [
            ['body', ''],
            [4, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [1, 'index'],
          ],
        },
        commonSurfaceIds: [
          '02acb19d-cc92-4cae-9e55-d6dbefb78705',
          '1b3c0e51-a51b-41d3-ae0a-1c9e0c18b57a',
        ],
      },
    ],
    [
      '5aa38d46-878d-5283-991a-bc7c92e01b9d',
      {
        type: 'segment',
        id: '5aa38d46-878d-5283-991a-bc7c92e01b9d',
        pathId: '2d6f6d5f-0e5f-5a4a-b262-2d11f87e411d',
        surfaceId: '79031810-43db-4b9f-a058-1b4f3b528796',
        edgeIds: [
          '872ea68a-b67d-4568-84c1-b891cb68f602',
          'e8691126-6320-40ee-ab78-c6033e9044a4',
        ],
        codeRef: {
          range: [479, 509, 0],
          pathToNode: [
            ['body', ''],
            [4, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [2, 'index'],
          ],
        },
        commonSurfaceIds: [
          '79031810-43db-4b9f-a058-1b4f3b528796',
          '1b3c0e51-a51b-41d3-ae0a-1c9e0c18b57a',
        ],
      },
    ],
    [
      '184c29e4-fcc5-52de-8325-db46e621428a',
      {
        type: 'segment',
        id: '184c29e4-fcc5-52de-8325-db46e621428a',
        pathId: '2d6f6d5f-0e5f-5a4a-b262-2d11f87e411d',
        surfaceId: 'd3f21af4-0c87-4b1b-88ff-754d1d3df39f',
        edgeIds: [
          '742d0d3e-e7e4-4484-b85c-31a76db8dd7c',
          '9ed007ff-3149-4a72-9b43-04f74c38a171',
        ],
        codeRef: {
          range: [515, 571, 0],
          pathToNode: [
            ['body', ''],
            [4, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [3, 'index'],
          ],
        },
        commonSurfaceIds: [
          'd3f21af4-0c87-4b1b-88ff-754d1d3df39f',
          '1b3c0e51-a51b-41d3-ae0a-1c9e0c18b57a',
        ],
      },
    ],
    [
      'bad45333-61e7-5c3a-ac4b-4efa333a6b90',
      {
        type: 'segment',
        id: 'bad45333-61e7-5c3a-ac4b-4efa333a6b90',
        pathId: '2d6f6d5f-0e5f-5a4a-b262-2d11f87e411d',
        codeRef: {
          range: [577, 584, 0],
          pathToNode: [
            ['body', ''],
            [4, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [4, 'index'],
          ],
        },
      },
    ],
    [
      'fd13e492-2201-4ac5-b169-82d1b42f8d10',
      {
        type: 'solid2d',
        id: 'fd13e492-2201-4ac5-b169-82d1b42f8d10',
        pathId: '2d6f6d5f-0e5f-5a4a-b262-2d11f87e411d',
      },
    ],
    [
      '513a2eb1-ada0-51b1-83d7-4990db8676dc',
      {
        type: 'sweep',
        id: '513a2eb1-ada0-51b1-83d7-4990db8676dc',
        subType: 'extrusion',
        pathId: '2d6f6d5f-0e5f-5a4a-b262-2d11f87e411d',
        surfaceIds: [
          'd3f21af4-0c87-4b1b-88ff-754d1d3df39f',
          '79031810-43db-4b9f-a058-1b4f3b528796',
          '02acb19d-cc92-4cae-9e55-d6dbefb78705',
          'eecb1d39-c251-449a-b815-c0fddeb31989',
        ],
        edgeIds: [
          '742d0d3e-e7e4-4484-b85c-31a76db8dd7c',
          '9ed007ff-3149-4a72-9b43-04f74c38a171',
          '872ea68a-b67d-4568-84c1-b891cb68f602',
          'e8691126-6320-40ee-ab78-c6033e9044a4',
          '3e4b5133-5570-44f8-92c7-b39bd5baaa55',
        ],
        codeRef: {
          range: [598, 631, 0],
          pathToNode: [
            ['body', ''],
            [5, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
          ],
        },
      },
    ],
    [
      'd3f21af4-0c87-4b1b-88ff-754d1d3df39f',
      {
        type: 'wall',
        id: 'd3f21af4-0c87-4b1b-88ff-754d1d3df39f',
        segId: '184c29e4-fcc5-52de-8325-db46e621428a',
        sweepId: '513a2eb1-ada0-51b1-83d7-4990db8676dc',
        faceCodeRef: {
          range: [0, 0, 0],
          pathToNode: [],
        },
        cmdId: '467f144c-9023-5dca-8cde-52aa366a50f0',
      },
    ],
    [
      '79031810-43db-4b9f-a058-1b4f3b528796',
      {
        type: 'wall',
        id: '79031810-43db-4b9f-a058-1b4f3b528796',
        segId: '5aa38d46-878d-5283-991a-bc7c92e01b9d',
        sweepId: '513a2eb1-ada0-51b1-83d7-4990db8676dc',
        faceCodeRef: {
          range: [0, 0, 0],
          pathToNode: [],
        },
        cmdId: '467f144c-9023-5dca-8cde-52aa366a50f0',
      },
    ],
    [
      '02acb19d-cc92-4cae-9e55-d6dbefb78705',
      {
        type: 'wall',
        id: '02acb19d-cc92-4cae-9e55-d6dbefb78705',
        segId: '73b27fd2-22b5-54dd-89c3-2278d82ae319',
        sweepId: '513a2eb1-ada0-51b1-83d7-4990db8676dc',
        faceCodeRef: {
          range: [0, 0, 0],
          pathToNode: [],
        },
        cmdId: '467f144c-9023-5dca-8cde-52aa366a50f0',
      },
    ],
    [
      'eecb1d39-c251-449a-b815-c0fddeb31989',
      {
        type: 'cap',
        id: 'eecb1d39-c251-449a-b815-c0fddeb31989',
        subType: 'end',
        sweepId: '513a2eb1-ada0-51b1-83d7-4990db8676dc',
        pathIds: ['77937daa-3eb5-5987-815d-f0f60051c9c6'],
        faceCodeRef: {
          range: [644, 681, 0],
          pathToNode: [],
        },
        cmdId: '467f144c-9023-5dca-8cde-52aa366a50f0',
      },
    ],
    [
      '8ddb1c33-8519-4467-a50f-b3879f47ea03',
      {
        type: 'sweepEdge',
        id: '8ddb1c33-8519-4467-a50f-b3879f47ea03',
        subType: 'opposite',
        segId: 'f7861c82-8117-5bb5-af9c-be285026b0c6',
        cmdId: 'fc48a210-666e-5981-9498-be796451c958',
        sweepId: '0bfb95e2-1eae-560f-96e1-354e1ece4ac2',
        commonSurfaceIds: [
          '36584687-7151-4406-a51f-f07933ae1695',
          'f7afc2dd-859c-4b3b-8cac-01fcc13672ab',
        ],
      },
    ],
    [
      'b197cdad-d60f-4e3c-afdd-58e6f1c323f1',
      {
        type: 'sweepEdge',
        id: 'b197cdad-d60f-4e3c-afdd-58e6f1c323f1',
        subType: 'adjacent',
        segId: '5b1bf38f-6ccc-5d51-a58e-a66fb7e9af9e',
        cmdId: 'eadced5f-a463-5a9e-bb11-44174fe799a8',
        sweepId: '0bfb95e2-1eae-560f-96e1-354e1ece4ac2',
        commonSurfaceIds: [
          '36584687-7151-4406-a51f-f07933ae1695',
          '1b3c0e51-a51b-41d3-ae0a-1c9e0c18b57a',
        ],
      },
    ],
    [
      'feb3eb40-cc3f-4a56-bb97-4a6d31e95d15',
      {
        type: 'sweepEdge',
        id: 'feb3eb40-cc3f-4a56-bb97-4a6d31e95d15',
        subType: 'opposite',
        segId: '0edcccdd-3f57-5e86-84d9-90aac061b21e',
        cmdId: 'ddad9bdf-fa37-5479-8d16-1c3d898e9c05',
        sweepId: '0bfb95e2-1eae-560f-96e1-354e1ece4ac2',
        commonSurfaceIds: [
          '35628e3b-78d6-4de4-a43d-d96220004fe1',
          'f7afc2dd-859c-4b3b-8cac-01fcc13672ab',
        ],
      },
    ],
    [
      'b063089b-f929-4fe7-8df6-044f8b469990',
      {
        type: 'sweepEdge',
        id: 'b063089b-f929-4fe7-8df6-044f8b469990',
        subType: 'adjacent',
        segId: '0edcccdd-3f57-5e86-84d9-90aac061b21e',
        cmdId: '4b3930b1-3abd-5f35-b000-e52afece5054',
        sweepId: '0bfb95e2-1eae-560f-96e1-354e1ece4ac2',
        commonSurfaceIds: [
          '36584687-7151-4406-a51f-f07933ae1695',
          '35628e3b-78d6-4de4-a43d-d96220004fe1',
        ],
      },
    ],
    [
      '6ddaad54-f49d-498a-8935-0af5e055f5fd',
      {
        type: 'sweepEdge',
        id: '6ddaad54-f49d-498a-8935-0af5e055f5fd',
        subType: 'opposite',
        segId: '2bba5d49-d2a4-56bb-88c8-302a3fe1aca7',
        cmdId: '66bcc54e-e7b8-5cfc-b167-fadf8600ebd4',
        sweepId: '0bfb95e2-1eae-560f-96e1-354e1ece4ac2',
        commonSurfaceIds: [
          'c30f705c-f778-48df-8e1d-33f07dcceb90',
          'f7afc2dd-859c-4b3b-8cac-01fcc13672ab',
        ],
      },
    ],
    [
      '3315f045-caf3-46d6-9cb5-7b1c658ae562',
      {
        type: 'sweepEdge',
        id: '3315f045-caf3-46d6-9cb5-7b1c658ae562',
        subType: 'adjacent',
        segId: '2bba5d49-d2a4-56bb-88c8-302a3fe1aca7',
        cmdId: '0d7c74ca-d669-596b-acc6-12bce78b5d00',
        sweepId: '0bfb95e2-1eae-560f-96e1-354e1ece4ac2',
        commonSurfaceIds: [
          '35628e3b-78d6-4de4-a43d-d96220004fe1',
          'c30f705c-f778-48df-8e1d-33f07dcceb90',
        ],
      },
    ],
    [
      'f87a7e1e-a594-4c7d-bb06-e19b76092678',
      {
        type: 'sweepEdge',
        id: 'f87a7e1e-a594-4c7d-bb06-e19b76092678',
        subType: 'opposite',
        segId: '5b1bf38f-6ccc-5d51-a58e-a66fb7e9af9e',
        cmdId: '83a24ce2-6149-50fa-8a2e-05f52fbadc26',
        sweepId: '0bfb95e2-1eae-560f-96e1-354e1ece4ac2',
        commonSurfaceIds: [
          '1b3c0e51-a51b-41d3-ae0a-1c9e0c18b57a',
          'f7afc2dd-859c-4b3b-8cac-01fcc13672ab',
        ],
      },
    ],
    [
      '77937daa-3eb5-5987-815d-f0f60051c9c6',
      {
        type: 'path',
        id: '77937daa-3eb5-5987-815d-f0f60051c9c6',
        planeId: 'eecb1d39-c251-449a-b815-c0fddeb31989',
        segIds: ['982833c0-35c7-57ac-89dd-f832a7fdf422'],
        solid2dId: 'cccd1fe8-c69a-41ae-bca3-51479890cccd',
        codeRef: {
          range: [695, 756, 0],
          pathToNode: [
            ['body', ''],
            [7, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
          ],
        },
      },
    ],
    [
      '982833c0-35c7-57ac-89dd-f832a7fdf422',
      {
        type: 'segment',
        id: '982833c0-35c7-57ac-89dd-f832a7fdf422',
        pathId: '77937daa-3eb5-5987-815d-f0f60051c9c6',
        codeRef: {
          range: [695, 756, 0],
          pathToNode: [
            ['body', ''],
            [7, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
          ],
        },
      },
    ],
    [
      'cccd1fe8-c69a-41ae-bca3-51479890cccd',
      {
        type: 'solid2d',
        id: 'cccd1fe8-c69a-41ae-bca3-51479890cccd',
        pathId: '77937daa-3eb5-5987-815d-f0f60051c9c6',
      },
    ],
    [
      '6d22e8ef-40c6-5663-84a7-f974e53c8226',
      {
        type: 'path',
        id: '6d22e8ef-40c6-5663-84a7-f974e53c8226',
        planeId: 'c30f705c-f778-48df-8e1d-33f07dcceb90',
        segIds: [
          'b488bc50-6fa9-5036-8b6a-c80e325fceee',
          '88a5fb18-3a08-5dbb-8de5-365fe1bec329',
          '67ded251-2cf9-5a55-a7c7-59369f204c40',
          'd336f530-1154-5a0e-b032-1246a52f383b',
          'b9bce958-792d-5190-ba3c-eaa8ee7aa368',
        ],
        solid2dId: 'cb118790-15e0-4f71-87d7-15a9e42ca40d',
        codeRef: {
          range: [822, 866, 0],
          pathToNode: [
            ['body', ''],
            [9, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [0, 'index'],
          ],
        },
      },
    ],
    [
      'b488bc50-6fa9-5036-8b6a-c80e325fceee',
      {
        type: 'segment',
        id: 'b488bc50-6fa9-5036-8b6a-c80e325fceee',
        pathId: '6d22e8ef-40c6-5663-84a7-f974e53c8226',
        codeRef: {
          range: [872, 938, 0],
          pathToNode: [
            ['body', ''],
            [9, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [1, 'index'],
          ],
        },
      },
    ],
    [
      '88a5fb18-3a08-5dbb-8de5-365fe1bec329',
      {
        type: 'segment',
        id: '88a5fb18-3a08-5dbb-8de5-365fe1bec329',
        pathId: '6d22e8ef-40c6-5663-84a7-f974e53c8226',
        codeRef: {
          range: [944, 1014, 0],
          pathToNode: [
            ['body', ''],
            [9, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [2, 'index'],
          ],
        },
      },
    ],
    [
      '67ded251-2cf9-5a55-a7c7-59369f204c40',
      {
        type: 'segment',
        id: '67ded251-2cf9-5a55-a7c7-59369f204c40',
        pathId: '6d22e8ef-40c6-5663-84a7-f974e53c8226',
        codeRef: {
          range: [1020, 1108, 0],
          pathToNode: [
            ['body', ''],
            [9, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [3, 'index'],
          ],
        },
      },
    ],
    [
      'd336f530-1154-5a0e-b032-1246a52f383b',
      {
        type: 'segment',
        id: 'd336f530-1154-5a0e-b032-1246a52f383b',
        pathId: '6d22e8ef-40c6-5663-84a7-f974e53c8226',
        codeRef: {
          range: [1114, 1170, 0],
          pathToNode: [
            ['body', ''],
            [9, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [4, 'index'],
          ],
        },
      },
    ],
    [
      'b9bce958-792d-5190-ba3c-eaa8ee7aa368',
      {
        type: 'segment',
        id: 'b9bce958-792d-5190-ba3c-eaa8ee7aa368',
        pathId: '6d22e8ef-40c6-5663-84a7-f974e53c8226',
        codeRef: {
          range: [1176, 1183, 0],
          pathToNode: [
            ['body', ''],
            [9, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [5, 'index'],
          ],
        },
      },
    ],
    [
      'cb118790-15e0-4f71-87d7-15a9e42ca40d',
      {
        type: 'solid2d',
        id: 'cb118790-15e0-4f71-87d7-15a9e42ca40d',
        pathId: '6d22e8ef-40c6-5663-84a7-f974e53c8226',
      },
    ],
    [
      '403d6680-758a-5228-9c69-b1cba8437ec1',
      {
        type: 'path',
        id: '403d6680-758a-5228-9c69-b1cba8437ec1',
        planeId: 'c30f705c-f778-48df-8e1d-33f07dcceb90',
        segIds: [
          'af5fda78-d536-572d-b62e-a7bd379ee293',
          'a5116914-4686-5755-8085-41f27b6b7e44',
          'f3589016-3628-5507-947a-ec1b811af83e',
          '376c9e4e-0778-54f9-bdf2-5f8401c2db17',
          'b8d0780e-3def-5ac1-bd15-98ca3b053d16',
        ],
        solid2dId: 'befee397-994b-4ed4-825a-9f80457fe85a',
        codeRef: {
          range: [1249, 1295, 0],
          pathToNode: [
            ['body', ''],
            [11, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [0, 'index'],
          ],
        },
      },
    ],
    [
      'af5fda78-d536-572d-b62e-a7bd379ee293',
      {
        type: 'segment',
        id: 'af5fda78-d536-572d-b62e-a7bd379ee293',
        pathId: '403d6680-758a-5228-9c69-b1cba8437ec1',
        codeRef: {
          range: [1301, 1368, 0],
          pathToNode: [
            ['body', ''],
            [11, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [1, 'index'],
          ],
        },
      },
    ],
    [
      'a5116914-4686-5755-8085-41f27b6b7e44',
      {
        type: 'segment',
        id: 'a5116914-4686-5755-8085-41f27b6b7e44',
        pathId: '403d6680-758a-5228-9c69-b1cba8437ec1',
        codeRef: {
          range: [1374, 1444, 0],
          pathToNode: [
            ['body', ''],
            [11, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [2, 'index'],
          ],
        },
      },
    ],
    [
      'f3589016-3628-5507-947a-ec1b811af83e',
      {
        type: 'segment',
        id: 'f3589016-3628-5507-947a-ec1b811af83e',
        pathId: '403d6680-758a-5228-9c69-b1cba8437ec1',
        codeRef: {
          range: [1450, 1538, 0],
          pathToNode: [
            ['body', ''],
            [11, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [3, 'index'],
          ],
        },
      },
    ],
    [
      '376c9e4e-0778-54f9-bdf2-5f8401c2db17',
      {
        type: 'segment',
        id: '376c9e4e-0778-54f9-bdf2-5f8401c2db17',
        pathId: '403d6680-758a-5228-9c69-b1cba8437ec1',
        codeRef: {
          range: [1544, 1600, 0],
          pathToNode: [
            ['body', ''],
            [11, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [4, 'index'],
          ],
        },
      },
    ],
    [
      'b8d0780e-3def-5ac1-bd15-98ca3b053d16',
      {
        type: 'segment',
        id: 'b8d0780e-3def-5ac1-bd15-98ca3b053d16',
        pathId: '403d6680-758a-5228-9c69-b1cba8437ec1',
        codeRef: {
          range: [1606, 1613, 0],
          pathToNode: [
            ['body', ''],
            [11, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [5, 'index'],
          ],
        },
      },
    ],
    [
      'befee397-994b-4ed4-825a-9f80457fe85a',
      {
        type: 'solid2d',
        id: 'befee397-994b-4ed4-825a-9f80457fe85a',
        pathId: '403d6680-758a-5228-9c69-b1cba8437ec1',
      },
    ],
    [
      'cbce7813-eaee-59a6-9f30-8a964229c8ee',
      {
        type: 'path',
        id: 'cbce7813-eaee-59a6-9f30-8a964229c8ee',
        planeId: 'c30f705c-f778-48df-8e1d-33f07dcceb90',
        segIds: ['ef0c6ea8-bf67-5d81-9a3d-c5370ecbce4e'],
        solid2dId: 'db11f442-d447-456b-9a01-cb6ddfae0629',
        codeRef: {
          range: [1627, 1687, 0],
          pathToNode: [
            ['body', ''],
            [12, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
          ],
        },
      },
    ],
    [
      'ef0c6ea8-bf67-5d81-9a3d-c5370ecbce4e',
      {
        type: 'segment',
        id: 'ef0c6ea8-bf67-5d81-9a3d-c5370ecbce4e',
        pathId: 'cbce7813-eaee-59a6-9f30-8a964229c8ee',
        codeRef: {
          range: [1627, 1687, 0],
          pathToNode: [
            ['body', ''],
            [12, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
          ],
        },
      },
    ],
    [
      'db11f442-d447-456b-9a01-cb6ddfae0629',
      {
        type: 'solid2d',
        id: 'db11f442-d447-456b-9a01-cb6ddfae0629',
        pathId: 'cbce7813-eaee-59a6-9f30-8a964229c8ee',
      },
    ],
    [
      '742d0d3e-e7e4-4484-b85c-31a76db8dd7c',
      {
        type: 'sweepEdge',
        id: '742d0d3e-e7e4-4484-b85c-31a76db8dd7c',
        subType: 'opposite',
        segId: '184c29e4-fcc5-52de-8325-db46e621428a',
        cmdId: '281c7b2f-b60b-5916-a22a-2f95550bfa02',
        sweepId: '513a2eb1-ada0-51b1-83d7-4990db8676dc',
        commonSurfaceIds: [
          'd3f21af4-0c87-4b1b-88ff-754d1d3df39f',
          'eecb1d39-c251-449a-b815-c0fddeb31989',
        ],
      },
    ],
    [
      '9ed007ff-3149-4a72-9b43-04f74c38a171',
      {
        type: 'sweepEdge',
        id: '9ed007ff-3149-4a72-9b43-04f74c38a171',
        subType: 'adjacent',
        segId: '73b27fd2-22b5-54dd-89c3-2278d82ae319',
        cmdId: 'a202df40-568c-5004-b1ac-bee90c9270bd',
        sweepId: '513a2eb1-ada0-51b1-83d7-4990db8676dc',
        commonSurfaceIds: [
          'd3f21af4-0c87-4b1b-88ff-754d1d3df39f',
          '02acb19d-cc92-4cae-9e55-d6dbefb78705',
        ],
      },
    ],
    [
      '872ea68a-b67d-4568-84c1-b891cb68f602',
      {
        type: 'sweepEdge',
        id: '872ea68a-b67d-4568-84c1-b891cb68f602',
        subType: 'opposite',
        segId: '5aa38d46-878d-5283-991a-bc7c92e01b9d',
        cmdId: 'cbe914d4-4778-5956-956d-856cc2f84ae1',
        sweepId: '513a2eb1-ada0-51b1-83d7-4990db8676dc',
        commonSurfaceIds: [
          '79031810-43db-4b9f-a058-1b4f3b528796',
          'eecb1d39-c251-449a-b815-c0fddeb31989',
        ],
      },
    ],
    [
      'e8691126-6320-40ee-ab78-c6033e9044a4',
      {
        type: 'sweepEdge',
        id: 'e8691126-6320-40ee-ab78-c6033e9044a4',
        subType: 'adjacent',
        segId: '5aa38d46-878d-5283-991a-bc7c92e01b9d',
        cmdId: '05e502ad-9a39-5a1f-9dcb-c0bc86816bd1',
        sweepId: '513a2eb1-ada0-51b1-83d7-4990db8676dc',
        commonSurfaceIds: [
          '79031810-43db-4b9f-a058-1b4f3b528796',
          '02acb19d-cc92-4cae-9e55-d6dbefb78705',
        ],
      },
    ],
    [
      '3e4b5133-5570-44f8-92c7-b39bd5baaa55',
      {
        type: 'sweepEdge',
        id: '3e4b5133-5570-44f8-92c7-b39bd5baaa55',
        subType: 'opposite',
        segId: '73b27fd2-22b5-54dd-89c3-2278d82ae319',
        cmdId: '86edfd76-987d-56c0-bd0c-5535d1bbc20a',
        sweepId: '513a2eb1-ada0-51b1-83d7-4990db8676dc',
        commonSurfaceIds: [
          '02acb19d-cc92-4cae-9e55-d6dbefb78705',
          'eecb1d39-c251-449a-b815-c0fddeb31989',
        ],
      },
    ],
    [
      '87f9e2b6-7694-5281-97b0-9a4f7cbaa5c8',
      {
        type: 'startSketchOnFace',
        id: '87f9e2b6-7694-5281-97b0-9a4f7cbaa5c8',
        faceId: '1b3c0e51-a51b-41d3-ae0a-1c9e0c18b57a',
        codeRef: {
          range: [339, 378, 0],
          pathToNode: [
            ['body', ''],
            [3, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
          ],
        },
      },
    ],
    [
      '66a241c7-4422-5e26-b1dd-e01ff9137412',
      {
        type: 'startSketchOnFace',
        id: '66a241c7-4422-5e26-b1dd-e01ff9137412',
        faceId: 'eecb1d39-c251-449a-b815-c0fddeb31989',
        codeRef: {
          range: [644, 681, 0],
          pathToNode: [
            ['body', ''],
            [6, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
          ],
        },
      },
    ],
    [
      '0923234b-36f9-5dcf-8d97-bee05df4583d',
      {
        type: 'startSketchOnFace',
        id: '0923234b-36f9-5dcf-8d97-bee05df4583d',
        faceId: 'c30f705c-f778-48df-8e1d-33f07dcceb90',
        codeRef: {
          range: [769, 808, 0],
          pathToNode: [
            ['body', ''],
            [8, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
          ],
        },
      },
    ],
    [
      'f06738bb-2e28-5a48-869a-8f9a0bcfaae1',
      {
        type: 'startSketchOnFace',
        id: 'f06738bb-2e28-5a48-869a-8f9a0bcfaae1',
        faceId: 'c30f705c-f778-48df-8e1d-33f07dcceb90',
        codeRef: {
          range: [1196, 1235, 0],
          pathToNode: [
            ['body', ''],
            [10, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
          ],
        },
      },
    ],
  ]) as ArtifactGraph

  // Build the index locally instead of using engineCommandManager
  const artifactIndex = buildArtifactIndex(___artifactGraph)

  const cases = [
    [
      'basic segment selection',
      {
        snippet: `line(end = [109.03, -61.79])`,
        artifactDetails: {
          type: 'segment',
          range: [432, 432, 0],
          singleIdsKeys: ['id', 'pathId', 'surfaceId'],
          arrayIdsKeys: [
            {
              key: 'edgeIds',
              length: 2,
            },
          ],
        },
      },
    ],
    [
      'default plane selection',
      {
        snippet: 'sketch001 = startSketchOn(XZ)',
        artifactDetails: {
          type: 'plane',
          range: [31, 31, 0],
          singleIdsKeys: ['id'],
          arrayIdsKeys: [{ key: 'pathIds', length: 1 }],
        },
      },
    ],
    [
      'segment 2',
      {
        snippet: 'yLine(length = -310.12, tag = $seg02)',
        artifactDetails: {
          type: 'segment',
          range: [149, 149, 0],
          singleIdsKeys: ['id', 'pathId', 'surfaceId'],
          arrayIdsKeys: [{ key: 'edgeIds', length: 2 }],
        },
      },
    ],
    [
      'sketch on face plane selection',
      {
        snippet: 'sketch002 = startSketchOn(extrude001, face = seg01)',
        artifactDetails: {
          type: 'wall',
          range: [340, 340, 0],
          singleIdsKeys: ['id', 'segId', 'sweepId'],
          arrayIdsKeys: [{ key: 'pathIds', length: 1 }],
        },
      },
    ],
    [
      'extrude/sweep selection',
      {
        snippet: 'extrude001 = extrude(profile001, length = 500)',
        artifactDetails: {
          type: 'sweep',
          subType: 'extrusion',
          range: [294, 294, 0],
          singleIdsKeys: ['id', 'pathId'],
          arrayIdsKeys: [
            { key: 'surfaceIds', length: 6 },
            { key: 'edgeIds', length: 8 },
          ],
        },
      },
    ],
    [
      'path selection for a sketch on face',
      {
        snippet: 'profile002 = startProfile(sketch002, at = [-321.34, 361.76])',
        artifactDetails: {
          type: 'solid2d',
          range: [398, 398, 0],
          singleIdsKeys: ['id', 'pathId'],
          arrayIdsKeys: [],
        },
      },
    ],
    [
      'startSketch on for a end cap that is also sketch on face on face',
      {
        snippet: 'sketch005 = startSketchOn(extrude002, face = END)',
        artifactDetails: {
          type: 'cap',
          subType: 'end',
          range: [635, 635, 0],
          singleIdsKeys: ['id', 'sweepId'],
          arrayIdsKeys: [{ key: 'pathIds', length: 2 }],
        },
      },
    ],
  ] as const

  test.each(cases)(
    `testing source range to artifact %s`,
    async (_name, { snippet, artifactDetails }) => {
      const ast = assertParse(MY_CODE)
      const lineIndex = MY_CODE.indexOf(snippet)
      expect(lineIndex).toBeGreaterThanOrEqual(0)
      const end = lineIndex + snippet.length
      const path = getNodePathFromSourceRange(ast, [lineIndex, end, 0])
      const selections: Selection[] = [
        {
          codeRef: {
            range: [end, end, 0],
            pathToNode: path,
          },
        },
      ]
      console.warn('ADAM: Snippet =', snippet)
      const [artifactSelection] = codeToIdSelections(
        selections,
        ___artifactGraph,
        artifactIndex
      )
      console.warn('ADAM: artifactSelection=', artifactSelection)
      expect(artifactSelection.id).toBeTruthy()
      if (!artifactSelection.id) {
        throw new Error('id is falsy')
      }
      const artifact = ___artifactGraph.get(artifactSelection.id)
      expect(artifact).toBeTruthy()
      if (!artifact) {
        throw new Error('artifact is falsy')
      }
      expect(artifact.type).toBe(artifactDetails.type)
      if ('subType' in artifactDetails) {
        expect((artifact as any).subType).toBe(artifactDetails.subType)
      }
      for (const key of artifactDetails.singleIdsKeys) {
        expect((artifact as any)[key]).toBeTruthy()
      }
      for (const { key, length } of artifactDetails.arrayIdsKeys) {
        expect((artifact as any)[key]).toHaveLength(length)
      }
    }
  )
})

describe('findLastRangeStartingBefore', () => {
  test('finds last range starting before target even if no overlap', () => {
    const mockIndex = [
      {
        range: [1, 2, 0] as SourceRange,
        entry: { id: '1', artifact: { id: '1', type: 'segment' } as Artifact },
      },
      {
        range: [35, 43, 0] as SourceRange,
        entry: { id: '2', artifact: { id: '2', type: 'segment' } as Artifact },
      },
      {
        range: [46, 70, 0] as SourceRange,
        entry: { id: '3', artifact: { id: '3', type: 'segment' } as Artifact },
      },
    ] as ArtifactIndex

    const result = findLastRangeStartingBefore(mockIndex, 45)
    expect(result).toBe(1) // Should return index 1 ([35, 43])
  })

  test('handles empty index', () => {
    const result = findLastRangeStartingBefore([] as ArtifactIndex, 45)
    // fine to return 0 in this case because the linear search section will sort out the lack of overlap
    expect(result).toBe(0)
  })

  test('handles target before all ranges', () => {
    const mockIndex = [
      {
        range: [10, 20, 0] as SourceRange,
        entry: { id: '1', artifact: { id: '1', type: 'segment' } as Artifact },
      },
      {
        range: [30, 40, 0] as SourceRange,
        entry: { id: '2', artifact: { id: '2', type: 'segment' } as Artifact },
      },
    ] as ArtifactIndex

    const result = findLastRangeStartingBefore(mockIndex, 5)
    // fine to return 0 in this case because the linear search section will sort out the lack of overlap
    expect(result).toBe(0)
  })

  test('handles target after all ranges', () => {
    const mockIndex = [
      {
        range: [10, 20, 0] as SourceRange,
        entry: { id: '1', artifact: { id: '1', type: 'segment' } as Artifact },
      },
      {
        range: [30, 40, 0] as SourceRange,
        entry: { id: '2', artifact: { id: '2', type: 'segment' } as Artifact },
      },
    ] as ArtifactIndex

    const result = findLastRangeStartingBefore(mockIndex, 50)
    expect(result).toBe(1)
  })

  test('handles duplicate ranges', () => {
    const mockIndex = [
      {
        range: [10, 20, 0] as SourceRange,
        entry: { id: '1', artifact: { id: '1', type: 'segment' } as Artifact },
      },
      {
        range: [30, 40, 0] as SourceRange,
        entry: { id: '2', artifact: { id: '2', type: 'segment' } as Artifact },
      },
      {
        range: [30, 40, 0] as SourceRange,
        entry: { id: '3', artifact: { id: '3', type: 'segment' } as Artifact },
      },
    ] as ArtifactIndex

    const result = findLastRangeStartingBefore(mockIndex, 50)
    expect(result).toBe(1)
  })
})
