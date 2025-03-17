import { expect } from 'vitest'

import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import type { Artifact } from '@src/lang/std/artifactGraph'
import type { ArtifactGraph, SourceRange } from '@src/lang/wasm'
import { assertParse, initPromise } from '@src/lang/wasm'
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
profile001 = startProfileAt([105.55, 105.55], sketch001)
  |> xLine(332.55, %, $seg01)
  |> yLine(-310.12, %, $seg02)
  |> xLine(-373.65, %)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 500)

sketch002 = startSketchOn(extrude001, seg01)
profile002 = startProfileAt([-321.34, 361.76], sketch002)
  |> line(end = [109.03, -61.79])
  |> line(end = [-124.48, -132.65])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude002 = extrude(profile002, length = 500)
sketch005 = startSketchOn(extrude002, 'END')
profile006 = circle(sketch005,
  center = [-292.57, 302.55],
  radius = 25.89
)
sketch004 = startSketchOn(extrude001, seg02)
profile005 = startProfileAt([36.1, 174.49], sketch004)
  |> angledLine(angle = 0, length = 22.33, tag = $rectangleSegmentA003)
  |> angledLine([
       segAng(rectangleSegmentA003) - 90,
       155.27
     ], %)
  |> angledLine([
       segAng(rectangleSegmentA003),
       -segLen(rectangleSegmentA003)
     ], %)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
sketch003 = startSketchOn(extrude001, seg02)
profile003 = startProfileAt([-115.59, 439.4], sketch003)
  |> angledLine(angle = 0, length = 130.08, tag = $rectangleSegmentA002)
  |> angledLine([
       segAng(rectangleSegmentA002) - 90,
       123.84
     ], %)
  |> angledLine([
       segAng(rectangleSegmentA002),
       -segLen(rectangleSegmentA002)
     ], %)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
profile004 = circle(sketch003,
  center = [-88.54, 209.41],
  radius = 42.72
)
`
  const ___artifactGraph = new Map([
    [
      'c25d213e-0d04-4ec0-85f9-21deb17a9eca',
      {
        type: 'plane',
        id: 'c25d213e-0d04-4ec0-85f9-21deb17a9eca',
        pathIds: ['8b84b28e-b521-45e6-bea0-2b57e5dc2064'],
        codeRef: {
          range: [12, 31, 0],
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
      '8b84b28e-b521-45e6-bea0-2b57e5dc2064',
      {
        type: 'path',
        id: '8b84b28e-b521-45e6-bea0-2b57e5dc2064',
        planeId: 'c25d213e-0d04-4ec0-85f9-21deb17a9eca',
        segIds: [
          '0ac92ce1-384d-42c2-93ee-d6073cb6301c',
          'a19c04df-107c-4744-b575-d76957eed2de',
          'bbba630d-3b40-4c18-b9ce-97e2c63c4198',
          '631d0a75-05da-48be-9ad5-ea0bfa7efc12',
          'e211240e-c634-43e2-a502-41dc9c291708',
        ],
        sweepId: '07cade68-136c-4ba9-8e69-87e56998d264',
        solid2dId: '5289aace-0493-4238-a32e-1c61b3e10b9e',
        codeRef: {
          range: [45, 88, 0],
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
      '0ac92ce1-384d-42c2-93ee-d6073cb6301c',
      {
        type: 'segment',
        id: '0ac92ce1-384d-42c2-93ee-d6073cb6301c',
        pathId: '8b84b28e-b521-45e6-bea0-2b57e5dc2064',
        surfaceId: '08c1481a-9c17-41df-baf9-8ef253cb8c83',
        edgeIds: [
          '447ea755-6f79-40de-8cf5-17685a0b039d',
          '24ae3c52-3bd2-4a21-b48a-37439375cd5f',
        ],
        codeRef: {
          range: [94, 118, 0],
          pathToNode: [
            ['body', ''],
            [1, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [1, 'index'],
          ],
        },
      },
    ],
    [
      'a19c04df-107c-4744-b575-d76957eed2de',
      {
        type: 'segment',
        id: 'a19c04df-107c-4744-b575-d76957eed2de',
        pathId: '8b84b28e-b521-45e6-bea0-2b57e5dc2064',
        surfaceId: '9314d48d-5963-492e-8bda-2acbe5df29e9',
        edgeIds: [
          '32079948-0977-42be-95c3-662cc455d9ff',
          '9c7b1d9b-fd4d-4c58-a7e9-262627ba0fdd',
        ],
        codeRef: {
          range: [124, 149, 0],
          pathToNode: [
            ['body', ''],
            [1, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [2, 'index'],
          ],
        },
      },
    ],
    [
      'bbba630d-3b40-4c18-b9ce-97e2c63c4198',
      {
        type: 'segment',
        id: 'bbba630d-3b40-4c18-b9ce-97e2c63c4198',
        pathId: '8b84b28e-b521-45e6-bea0-2b57e5dc2064',
        surfaceId: 'ab90c913-ed62-4802-a5a6-0082789a97e3',
        edgeIds: [
          '89acf940-0d8b-4eea-bc42-f0536b8da366',
          '05a4f54b-3fd6-4842-b871-fff7379fef33',
        ],
        codeRef: {
          range: [155, 172, 0],
          pathToNode: [
            ['body', ''],
            [1, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [3, 'index'],
          ],
        },
      },
    ],
    [
      '631d0a75-05da-48be-9ad5-ea0bfa7efc12',
      {
        type: 'segment',
        id: '631d0a75-05da-48be-9ad5-ea0bfa7efc12',
        pathId: '8b84b28e-b521-45e6-bea0-2b57e5dc2064',
        surfaceId: '793445be-45df-4126-aa57-3260984b1a3a',
        edgeIds: [
          '22245d83-6502-4d39-a665-86cf44a3aeb0',
          'f870f7d8-35cb-4190-a46b-0154b01f5b7e',
        ],
        codeRef: {
          range: [178, 234, 0],
          pathToNode: [
            ['body', ''],
            [1, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [4, 'index'],
          ],
        },
      },
    ],
    [
      'e211240e-c634-43e2-a502-41dc9c291708',
      {
        type: 'segment',
        id: 'e211240e-c634-43e2-a502-41dc9c291708',
        pathId: '8b84b28e-b521-45e6-bea0-2b57e5dc2064',
        codeRef: {
          range: [240, 247, 0],
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
      '5289aace-0493-4238-a32e-1c61b3e10b9e',
      {
        type: 'solid2d',
        id: '5289aace-0493-4238-a32e-1c61b3e10b9e',
        pathId: '8b84b28e-b521-45e6-bea0-2b57e5dc2064',
      },
    ],
    [
      '07cade68-136c-4ba9-8e69-87e56998d264',
      {
        type: 'sweep',
        id: '07cade68-136c-4ba9-8e69-87e56998d264',
        subType: 'extrusion',
        pathId: '8b84b28e-b521-45e6-bea0-2b57e5dc2064',
        surfaceIds: [
          '793445be-45df-4126-aa57-3260984b1a3a',
          'ab90c913-ed62-4802-a5a6-0082789a97e3',
          '9314d48d-5963-492e-8bda-2acbe5df29e9',
          '08c1481a-9c17-41df-baf9-8ef253cb8c83',
          '169e55f4-8439-4040-b531-e6e63c7a22f1',
          '9f50004b-2015-4e6f-b79a-652ea66ad229',
        ],
        edgeIds: [
          '22245d83-6502-4d39-a665-86cf44a3aeb0',
          'f870f7d8-35cb-4190-a46b-0154b01f5b7e',
          '89acf940-0d8b-4eea-bc42-f0536b8da366',
          '05a4f54b-3fd6-4842-b871-fff7379fef33',
          '32079948-0977-42be-95c3-662cc455d9ff',
          '9c7b1d9b-fd4d-4c58-a7e9-262627ba0fdd',
          '447ea755-6f79-40de-8cf5-17685a0b039d',
          '24ae3c52-3bd2-4a21-b48a-37439375cd5f',
        ],
        codeRef: {
          range: [261, 294, 0],
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
      '793445be-45df-4126-aa57-3260984b1a3a',
      {
        type: 'wall',
        id: '793445be-45df-4126-aa57-3260984b1a3a',
        segId: '631d0a75-05da-48be-9ad5-ea0bfa7efc12',
        sweepId: '07cade68-136c-4ba9-8e69-87e56998d264',
        faceCodeRef: { range: [0, 0, 0], pathToNode: [] },
      },
    ],
    [
      'ab90c913-ed62-4802-a5a6-0082789a97e3',
      {
        type: 'wall',
        id: 'ab90c913-ed62-4802-a5a6-0082789a97e3',
        segId: 'bbba630d-3b40-4c18-b9ce-97e2c63c4198',
        sweepId: '07cade68-136c-4ba9-8e69-87e56998d264',
        faceCodeRef: { range: [0, 0, 0], pathToNode: [] },
      },
    ],
    [
      '9314d48d-5963-492e-8bda-2acbe5df29e9',
      {
        type: 'wall',
        id: '9314d48d-5963-492e-8bda-2acbe5df29e9',
        segId: 'a19c04df-107c-4744-b575-d76957eed2de',
        sweepId: '07cade68-136c-4ba9-8e69-87e56998d264',
        pathIds: [
          '8a98773e-d965-4ef8-b7a0-784cd0e05fcb',
          '04a1735a-3ce9-476f-b35f-e4e9439485ea',
          '64c477ee-6206-424f-98e2-baecc387de86',
        ],
        faceCodeRef: { range: [853, 885, 0], pathToNode: [] },
      },
    ],
    [
      '08c1481a-9c17-41df-baf9-8ef253cb8c83',
      {
        type: 'wall',
        id: '08c1481a-9c17-41df-baf9-8ef253cb8c83',
        segId: '0ac92ce1-384d-42c2-93ee-d6073cb6301c',
        sweepId: '07cade68-136c-4ba9-8e69-87e56998d264',
        pathIds: ['9c837ce4-a600-43e8-a799-496016816409'],
        faceCodeRef: { range: [308, 340, 0], pathToNode: [] },
      },
    ],
    [
      '169e55f4-8439-4040-b531-e6e63c7a22f1',
      {
        type: 'cap',
        id: '169e55f4-8439-4040-b531-e6e63c7a22f1',
        subType: 'start',
        sweepId: '07cade68-136c-4ba9-8e69-87e56998d264',
        faceCodeRef: { range: [0, 0, 0], pathToNode: [] },
      },
    ],
    [
      '9f50004b-2015-4e6f-b79a-652ea66ad229',
      {
        type: 'cap',
        id: '9f50004b-2015-4e6f-b79a-652ea66ad229',
        subType: 'end',
        sweepId: '07cade68-136c-4ba9-8e69-87e56998d264',
        faceCodeRef: { range: [0, 0, 0], pathToNode: [] },
      },
    ],
    [
      '22245d83-6502-4d39-a665-86cf44a3aeb0',
      {
        type: 'sweepEdge',
        id: '22245d83-6502-4d39-a665-86cf44a3aeb0',
        subType: 'opposite',
        segId: '631d0a75-05da-48be-9ad5-ea0bfa7efc12',
        sweepId: '07cade68-136c-4ba9-8e69-87e56998d264',
      },
    ],
    [
      'f870f7d8-35cb-4190-a46b-0154b01f5b7e',
      {
        type: 'sweepEdge',
        id: 'f870f7d8-35cb-4190-a46b-0154b01f5b7e',
        subType: 'adjacent',
        segId: '631d0a75-05da-48be-9ad5-ea0bfa7efc12',
        sweepId: '07cade68-136c-4ba9-8e69-87e56998d264',
      },
    ],
    [
      '89acf940-0d8b-4eea-bc42-f0536b8da366',
      {
        type: 'sweepEdge',
        id: '89acf940-0d8b-4eea-bc42-f0536b8da366',
        subType: 'opposite',
        segId: 'bbba630d-3b40-4c18-b9ce-97e2c63c4198',
        sweepId: '07cade68-136c-4ba9-8e69-87e56998d264',
      },
    ],
    [
      '05a4f54b-3fd6-4842-b871-fff7379fef33',
      {
        type: 'sweepEdge',
        id: '05a4f54b-3fd6-4842-b871-fff7379fef33',
        subType: 'adjacent',
        segId: 'bbba630d-3b40-4c18-b9ce-97e2c63c4198',
        sweepId: '07cade68-136c-4ba9-8e69-87e56998d264',
      },
    ],
    [
      '32079948-0977-42be-95c3-662cc455d9ff',
      {
        type: 'sweepEdge',
        id: '32079948-0977-42be-95c3-662cc455d9ff',
        subType: 'opposite',
        segId: 'a19c04df-107c-4744-b575-d76957eed2de',
        sweepId: '07cade68-136c-4ba9-8e69-87e56998d264',
      },
    ],
    [
      '9c7b1d9b-fd4d-4c58-a7e9-262627ba0fdd',
      {
        type: 'sweepEdge',
        id: '9c7b1d9b-fd4d-4c58-a7e9-262627ba0fdd',
        subType: 'adjacent',
        segId: 'a19c04df-107c-4744-b575-d76957eed2de',
        sweepId: '07cade68-136c-4ba9-8e69-87e56998d264',
      },
    ],
    [
      '447ea755-6f79-40de-8cf5-17685a0b039d',
      {
        type: 'sweepEdge',
        id: '447ea755-6f79-40de-8cf5-17685a0b039d',
        subType: 'opposite',
        segId: '0ac92ce1-384d-42c2-93ee-d6073cb6301c',
        sweepId: '07cade68-136c-4ba9-8e69-87e56998d264',
      },
    ],
    [
      '24ae3c52-3bd2-4a21-b48a-37439375cd5f',
      {
        type: 'sweepEdge',
        id: '24ae3c52-3bd2-4a21-b48a-37439375cd5f',
        subType: 'adjacent',
        segId: '0ac92ce1-384d-42c2-93ee-d6073cb6301c',
        sweepId: '07cade68-136c-4ba9-8e69-87e56998d264',
      },
    ],
    [
      '9c837ce4-a600-43e8-a799-496016816409',
      {
        type: 'path',
        id: '9c837ce4-a600-43e8-a799-496016816409',
        planeId: '08c1481a-9c17-41df-baf9-8ef253cb8c83',
        segIds: [
          'c7620b36-0eee-42dd-89dd-8b49a808d9fa',
          '83921e4a-fd8b-4b91-a38e-42b10bd0f1d6',
          '500f8da6-c0b0-4953-87e7-67e6615094b7',
          '567628ff-0f5c-4cab-aaa2-3e5812c23f55',
        ],
        sweepId: '1c8e1237-9df0-407a-8278-84f634f1a88f',
        solid2dId: 'f614b055-bd1c-422c-9f97-6ddf59138a2b',
        codeRef: {
          range: [354, 398, 0],
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
      'c7620b36-0eee-42dd-89dd-8b49a808d9fa',
      {
        type: 'segment',
        id: 'c7620b36-0eee-42dd-89dd-8b49a808d9fa',
        pathId: '9c837ce4-a600-43e8-a799-496016816409',
        surfaceId: '04f5614d-9558-4ec4-9374-d6cf1513ee49',
        edgeIds: [
          '20a8f3a1-6628-4484-9aa6-eec15044eecd',
          '49113603-5e8c-49f8-a371-d68ee32b72fa',
        ],
        codeRef: {
          range: [404, 432, 0],
          pathToNode: [
            ['body', ''],
            [4, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [1, 'index'],
          ],
        },
      },
    ],
    [
      '83921e4a-fd8b-4b91-a38e-42b10bd0f1d6',
      {
        type: 'segment',
        id: '83921e4a-fd8b-4b91-a38e-42b10bd0f1d6',
        pathId: '9c837ce4-a600-43e8-a799-496016816409',
        surfaceId: '96766e17-a80b-42d1-a3e2-a3d8d53a6a2c',
        edgeIds: [
          'd06ed974-d3d9-4374-b5ee-9778877d4c4e',
          '240d085b-4e1a-4838-9457-cae006c5f3cd',
        ],
        codeRef: {
          range: [438, 468, 0],
          pathToNode: [
            ['body', ''],
            [4, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [2, 'index'],
          ],
        },
      },
    ],
    [
      '500f8da6-c0b0-4953-87e7-67e6615094b7',
      {
        type: 'segment',
        id: '500f8da6-c0b0-4953-87e7-67e6615094b7',
        pathId: '9c837ce4-a600-43e8-a799-496016816409',
        surfaceId: '93c02952-c588-49d6-8df4-c666cdfae566',
        edgeIds: [
          'd8acb73e-0856-419e-8f0c-08ca5a50248e',
          '05d17802-82a2-4c9b-bb3f-6ee8b0deeefa',
        ],
        codeRef: {
          range: [474, 530, 0],
          pathToNode: [
            ['body', ''],
            [4, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [3, 'index'],
          ],
        },
      },
    ],
    [
      '567628ff-0f5c-4cab-aaa2-3e5812c23f55',
      {
        type: 'segment',
        id: '567628ff-0f5c-4cab-aaa2-3e5812c23f55',
        pathId: '9c837ce4-a600-43e8-a799-496016816409',
        codeRef: {
          range: [536, 543, 0],
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
      'f614b055-bd1c-422c-9f97-6ddf59138a2b',
      {
        type: 'solid2d',
        id: 'f614b055-bd1c-422c-9f97-6ddf59138a2b',
        pathId: '9c837ce4-a600-43e8-a799-496016816409',
      },
    ],
    [
      '1c8e1237-9df0-407a-8278-84f634f1a88f',
      {
        type: 'sweep',
        id: '1c8e1237-9df0-407a-8278-84f634f1a88f',
        subType: 'extrusion',
        pathId: '9c837ce4-a600-43e8-a799-496016816409',
        surfaceIds: [
          '93c02952-c588-49d6-8df4-c666cdfae566',
          '96766e17-a80b-42d1-a3e2-a3d8d53a6a2c',
          '04f5614d-9558-4ec4-9374-d6cf1513ee49',
          '88f83820-9c86-4c62-9f5f-0c48db2bb055',
        ],
        edgeIds: [
          'd8acb73e-0856-419e-8f0c-08ca5a50248e',
          '05d17802-82a2-4c9b-bb3f-6ee8b0deeefa',
          'd06ed974-d3d9-4374-b5ee-9778877d4c4e',
          '240d085b-4e1a-4838-9457-cae006c5f3cd',
          '20a8f3a1-6628-4484-9aa6-eec15044eecd',
          '49113603-5e8c-49f8-a371-d68ee32b72fa',
        ],
        codeRef: {
          range: [557, 590, 0],
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
      '93c02952-c588-49d6-8df4-c666cdfae566',
      {
        type: 'wall',
        id: '93c02952-c588-49d6-8df4-c666cdfae566',
        segId: '500f8da6-c0b0-4953-87e7-67e6615094b7',
        sweepId: '1c8e1237-9df0-407a-8278-84f634f1a88f',
        faceCodeRef: { range: [0, 0, 0], pathToNode: [] },
      },
    ],
    [
      '96766e17-a80b-42d1-a3e2-a3d8d53a6a2c',
      {
        type: 'wall',
        id: '96766e17-a80b-42d1-a3e2-a3d8d53a6a2c',
        segId: '83921e4a-fd8b-4b91-a38e-42b10bd0f1d6',
        sweepId: '1c8e1237-9df0-407a-8278-84f634f1a88f',
        faceCodeRef: { range: [0, 0, 0], pathToNode: [] },
      },
    ],
    [
      '04f5614d-9558-4ec4-9374-d6cf1513ee49',
      {
        type: 'wall',
        id: '04f5614d-9558-4ec4-9374-d6cf1513ee49',
        segId: 'c7620b36-0eee-42dd-89dd-8b49a808d9fa',
        sweepId: '1c8e1237-9df0-407a-8278-84f634f1a88f',
        faceCodeRef: { range: [0, 0, 0], pathToNode: [] },
      },
    ],
    [
      '88f83820-9c86-4c62-9f5f-0c48db2bb055',
      {
        type: 'cap',
        id: '88f83820-9c86-4c62-9f5f-0c48db2bb055',
        subType: 'end',
        sweepId: '1c8e1237-9df0-407a-8278-84f634f1a88f',
        pathIds: [
          '4316b730-b653-422c-b7ca-cc1591870de5',
          '0e1815f5-a128-4323-9d5d-c1c17642ef74',
        ],
        faceCodeRef: { range: [603, 635, 0], pathToNode: [] },
      },
    ],
    [
      'd8acb73e-0856-419e-8f0c-08ca5a50248e',
      {
        type: 'sweepEdge',
        id: 'd8acb73e-0856-419e-8f0c-08ca5a50248e',
        subType: 'opposite',
        segId: '500f8da6-c0b0-4953-87e7-67e6615094b7',
        sweepId: '1c8e1237-9df0-407a-8278-84f634f1a88f',
      },
    ],
    [
      '05d17802-82a2-4c9b-bb3f-6ee8b0deeefa',
      {
        type: 'sweepEdge',
        id: '05d17802-82a2-4c9b-bb3f-6ee8b0deeefa',
        subType: 'adjacent',
        segId: '500f8da6-c0b0-4953-87e7-67e6615094b7',
        sweepId: '1c8e1237-9df0-407a-8278-84f634f1a88f',
      },
    ],
    [
      'd06ed974-d3d9-4374-b5ee-9778877d4c4e',
      {
        type: 'sweepEdge',
        id: 'd06ed974-d3d9-4374-b5ee-9778877d4c4e',
        subType: 'opposite',
        segId: '83921e4a-fd8b-4b91-a38e-42b10bd0f1d6',
        sweepId: '1c8e1237-9df0-407a-8278-84f634f1a88f',
      },
    ],
    [
      '240d085b-4e1a-4838-9457-cae006c5f3cd',
      {
        type: 'sweepEdge',
        id: '240d085b-4e1a-4838-9457-cae006c5f3cd',
        subType: 'adjacent',
        segId: '83921e4a-fd8b-4b91-a38e-42b10bd0f1d6',
        sweepId: '1c8e1237-9df0-407a-8278-84f634f1a88f',
      },
    ],
    [
      '20a8f3a1-6628-4484-9aa6-eec15044eecd',
      {
        type: 'sweepEdge',
        id: '20a8f3a1-6628-4484-9aa6-eec15044eecd',
        subType: 'opposite',
        segId: 'c7620b36-0eee-42dd-89dd-8b49a808d9fa',
        sweepId: '1c8e1237-9df0-407a-8278-84f634f1a88f',
      },
    ],
    [
      '49113603-5e8c-49f8-a371-d68ee32b72fa',
      {
        type: 'sweepEdge',
        id: '49113603-5e8c-49f8-a371-d68ee32b72fa',
        subType: 'adjacent',
        segId: 'c7620b36-0eee-42dd-89dd-8b49a808d9fa',
        sweepId: '1c8e1237-9df0-407a-8278-84f634f1a88f',
      },
    ],
    [
      '4316b730-b653-422c-b7ca-cc1591870de5',
      {
        type: 'path',
        id: '4316b730-b653-422c-b7ca-cc1591870de5',
        planeId: '88f83820-9c86-4c62-9f5f-0c48db2bb055',
        segIds: ['7e23a6a6-4a90-43a5-8a86-78ba915ad489'],
        solid2dId: 'db576b79-8e6d-443e-9cb7-64022e2cf4be',
        codeRef: {
          range: [649, 718, 0],
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
      '7e23a6a6-4a90-43a5-8a86-78ba915ad489',
      {
        type: 'segment',
        id: '7e23a6a6-4a90-43a5-8a86-78ba915ad489',
        pathId: '4316b730-b653-422c-b7ca-cc1591870de5',
        codeRef: {
          range: [649, 718, 0],
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
      'db576b79-8e6d-443e-9cb7-64022e2cf4be',
      {
        type: 'solid2d',
        id: 'db576b79-8e6d-443e-9cb7-64022e2cf4be',
        pathId: '4316b730-b653-422c-b7ca-cc1591870de5',
      },
    ],
    [
      '0e1815f5-a128-4323-9d5d-c1c17642ef74',
      {
        type: 'path',
        id: '0e1815f5-a128-4323-9d5d-c1c17642ef74',
        planeId: '88f83820-9c86-4c62-9f5f-0c48db2bb055',
        segIds: [
          '5b2448be-ae92-41cc-a9ac-e96393c79b9c',
          '27effd70-97fd-4057-ad5b-041eb3e2998b',
        ],
        codeRef: {
          range: [732, 776, 0],
          pathToNode: [
            ['body', ''],
            [8, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [0, 'index'],
          ],
        },
      },
    ],
    [
      '5b2448be-ae92-41cc-a9ac-e96393c79b9c',
      {
        type: 'segment',
        id: '5b2448be-ae92-41cc-a9ac-e96393c79b9c',
        pathId: '0e1815f5-a128-4323-9d5d-c1c17642ef74',
        codeRef: {
          range: [782, 808, 0],
          pathToNode: [
            ['body', ''],
            [8, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [1, 'index'],
          ],
        },
      },
    ],
    [
      '27effd70-97fd-4057-ad5b-041eb3e2998b',
      {
        type: 'segment',
        id: '27effd70-97fd-4057-ad5b-041eb3e2998b',
        pathId: '0e1815f5-a128-4323-9d5d-c1c17642ef74',
        codeRef: {
          range: [814, 840, 0],
          pathToNode: [
            ['body', ''],
            [8, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [2, 'index'],
          ],
        },
      },
    ],
    [
      '8a98773e-d965-4ef8-b7a0-784cd0e05fcb',
      {
        type: 'path',
        id: '8a98773e-d965-4ef8-b7a0-784cd0e05fcb',
        planeId: '9314d48d-5963-492e-8bda-2acbe5df29e9',
        segIds: [
          'f149263c-1e58-40e0-b5a3-3cb87fa75d8c',
          'f26505c7-4d98-4f88-af22-d257deac07be',
          'c77ff330-afbc-4709-b735-b651ea034866',
          'fbba311f-ecc9-4a3e-bca3-3c66878978c0',
          'fc85af86-cfed-4c2c-bc66-e67d208b9385',
        ],
        solid2dId: '6d78b893-6a95-432c-b342-bdb14a012833',
        codeRef: {
          range: [899, 940, 0],
          pathToNode: [
            ['body', ''],
            [10, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [0, 'index'],
          ],
        },
      },
    ],
    [
      'f149263c-1e58-40e0-b5a3-3cb87fa75d8c',
      {
        type: 'segment',
        id: 'f149263c-1e58-40e0-b5a3-3cb87fa75d8c',
        pathId: '8a98773e-d965-4ef8-b7a0-784cd0e05fcb',
        codeRef: {
          range: [946, 994, 0],
          pathToNode: [
            ['body', ''],
            [10, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [1, 'index'],
          ],
        },
      },
    ],
    [
      'f26505c7-4d98-4f88-af22-d257deac07be',
      {
        type: 'segment',
        id: 'f26505c7-4d98-4f88-af22-d257deac07be',
        pathId: '8a98773e-d965-4ef8-b7a0-784cd0e05fcb',
        codeRef: {
          range: [1000, 1079, 0],
          pathToNode: [
            ['body', ''],
            [10, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [2, 'index'],
          ],
        },
      },
    ],
    [
      'c77ff330-afbc-4709-b735-b651ea034866',
      {
        type: 'segment',
        id: 'c77ff330-afbc-4709-b735-b651ea034866',
        pathId: '8a98773e-d965-4ef8-b7a0-784cd0e05fcb',
        codeRef: {
          range: [1085, 1182, 0],
          pathToNode: [
            ['body', ''],
            [10, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [3, 'index'],
          ],
        },
      },
    ],
    [
      'fbba311f-ecc9-4a3e-bca3-3c66878978c0',
      {
        type: 'segment',
        id: 'fbba311f-ecc9-4a3e-bca3-3c66878978c0',
        pathId: '8a98773e-d965-4ef8-b7a0-784cd0e05fcb',
        codeRef: {
          range: [1188, 1244, 0],
          pathToNode: [
            ['body', ''],
            [10, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [4, 'index'],
          ],
        },
      },
    ],
    [
      'fc85af86-cfed-4c2c-bc66-e67d208b9385',
      {
        type: 'segment',
        id: 'fc85af86-cfed-4c2c-bc66-e67d208b9385',
        pathId: '8a98773e-d965-4ef8-b7a0-784cd0e05fcb',
        codeRef: {
          range: [1250, 1257, 0],
          pathToNode: [
            ['body', ''],
            [10, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [5, 'index'],
          ],
        },
      },
    ],
    [
      '6d78b893-6a95-432c-b342-bdb14a012833',
      {
        type: 'solid2d',
        id: '6d78b893-6a95-432c-b342-bdb14a012833',
        pathId: '8a98773e-d965-4ef8-b7a0-784cd0e05fcb',
      },
    ],
    [
      '04a1735a-3ce9-476f-b35f-e4e9439485ea',
      {
        type: 'path',
        id: '04a1735a-3ce9-476f-b35f-e4e9439485ea',
        planeId: '9314d48d-5963-492e-8bda-2acbe5df29e9',
        segIds: [
          'ca369e71-6d1b-483c-a9c4-f5ebdef24479',
          '5a3ebb81-8050-4ad1-a668-0882f005a4a8',
          'c9cf1dfa-1c3a-490f-9d26-071ea3c38e30',
          'a0e58546-572d-41f1-99dd-5d18db18cb00',
          '870eb08f-cef2-4fd3-8f7e-f5ef52fd7867',
        ],
        solid2dId: 'c3b75c5f-6976-4054-a7f1-8f5a5191771c',
        codeRef: {
          range: [1316, 1359, 0],
          pathToNode: [
            ['body', ''],
            [12, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [0, 'index'],
          ],
        },
      },
    ],
    [
      'ca369e71-6d1b-483c-a9c4-f5ebdef24479',
      {
        type: 'segment',
        id: 'ca369e71-6d1b-483c-a9c4-f5ebdef24479',
        pathId: '04a1735a-3ce9-476f-b35f-e4e9439485ea',
        codeRef: {
          range: [1365, 1414, 0],
          pathToNode: [
            ['body', ''],
            [12, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [1, 'index'],
          ],
        },
      },
    ],
    [
      '5a3ebb81-8050-4ad1-a668-0882f005a4a8',
      {
        type: 'segment',
        id: '5a3ebb81-8050-4ad1-a668-0882f005a4a8',
        pathId: '04a1735a-3ce9-476f-b35f-e4e9439485ea',
        codeRef: {
          range: [1420, 1499, 0],
          pathToNode: [
            ['body', ''],
            [12, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [2, 'index'],
          ],
        },
      },
    ],
    [
      'c9cf1dfa-1c3a-490f-9d26-071ea3c38e30',
      {
        type: 'segment',
        id: 'c9cf1dfa-1c3a-490f-9d26-071ea3c38e30',
        pathId: '04a1735a-3ce9-476f-b35f-e4e9439485ea',
        codeRef: {
          range: [1505, 1602, 0],
          pathToNode: [
            ['body', ''],
            [12, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [3, 'index'],
          ],
        },
      },
    ],
    [
      'a0e58546-572d-41f1-99dd-5d18db18cb00',
      {
        type: 'segment',
        id: 'a0e58546-572d-41f1-99dd-5d18db18cb00',
        pathId: '04a1735a-3ce9-476f-b35f-e4e9439485ea',
        codeRef: {
          range: [1608, 1664, 0],
          pathToNode: [
            ['body', ''],
            [12, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [4, 'index'],
          ],
        },
      },
    ],
    [
      '870eb08f-cef2-4fd3-8f7e-f5ef52fd7867',
      {
        type: 'segment',
        id: '870eb08f-cef2-4fd3-8f7e-f5ef52fd7867',
        pathId: '04a1735a-3ce9-476f-b35f-e4e9439485ea',
        codeRef: {
          range: [1670, 1677, 0],
          pathToNode: [
            ['body', ''],
            [12, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
            ['body', 'PipeExpression'],
            [5, 'index'],
          ],
        },
      },
    ],
    [
      'c3b75c5f-6976-4054-a7f1-8f5a5191771c',
      {
        type: 'solid2d',
        id: 'c3b75c5f-6976-4054-a7f1-8f5a5191771c',
        pathId: '04a1735a-3ce9-476f-b35f-e4e9439485ea',
      },
    ],
    [
      '64c477ee-6206-424f-98e2-baecc387de86',
      {
        type: 'path',
        id: '64c477ee-6206-424f-98e2-baecc387de86',
        planeId: '9314d48d-5963-492e-8bda-2acbe5df29e9',
        segIds: ['daa846da-c2f4-40ea-9c89-24c0ce558a10'],
        solid2dId: 'd7f1c4f1-1095-4a23-878d-723a0dadfc18',
        codeRef: {
          range: [1691, 1759, 0],
          pathToNode: [
            ['body', ''],
            [13, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
          ],
        },
      },
    ],
    [
      'daa846da-c2f4-40ea-9c89-24c0ce558a10',
      {
        type: 'segment',
        id: 'daa846da-c2f4-40ea-9c89-24c0ce558a10',
        pathId: '64c477ee-6206-424f-98e2-baecc387de86',
        codeRef: {
          range: [1691, 1759, 0],
          pathToNode: [
            ['body', ''],
            [13, 'index'],
            ['declaration', 'VariableDeclaration'],
            ['init', ''],
          ],
        },
      },
    ],
    [
      'd7f1c4f1-1095-4a23-878d-723a0dadfc18',
      {
        type: 'solid2d',
        id: 'd7f1c4f1-1095-4a23-878d-723a0dadfc18',
        pathId: '64c477ee-6206-424f-98e2-baecc387de86',
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
        snippet: 'yLine(-310.12, %, $seg02)',
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
        snippet: 'sketch002 = startSketchOn(extrude001, seg01)',
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
        snippet: 'profile002 = startProfileAt([-321.34, 361.76], sketch002)',
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
        snippet: "sketch005 = startSketchOn(extrude002, 'END')",
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
      const [artifactSelection] = codeToIdSelections(
        selections,
        ___artifactGraph,
        artifactIndex
      )
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
})
