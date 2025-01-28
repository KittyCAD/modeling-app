import {
  createCutList,
  LumberToCut,
  Offcut,
  STANDARD_TIMBER_LENGTH,
  uuider,
} from './cutlist'

it('it should simple case where a second length is needed and it has to redo order to fit a shorter length towards the end on the first length of timber', () => {
  const uuid = uuider()
  let initialOffcutList: Offcut[] = [
    {
      length: STANDARD_TIMBER_LENGTH,
      lastAngle: 0,
      angleRelevantWidth: 90,
      timberLengthId: uuid(),
    },
  ]

  let initialLumbersToCut: LumberToCut[] = [
    {
      angleRelevantWidth: 90,
      depth: 35,
      lengthBeforeAngles: 2000,
      angle1: 0,
      angle2: 0,
      name: 'a',
    },
    {
      angleRelevantWidth: 90,
      depth: 35,
      lengthBeforeAngles: 1500,
      angle1: 0,
      angle2: 45,
      name: 'b',
    },
    {
      angleRelevantWidth: 90,
      depth: 35,
      lengthBeforeAngles: 1000,
      angle1: -50,
      angle2: 0,
      name: 'c',
    },
    {
      angleRelevantWidth: 90,
      depth: 35,
      lengthBeforeAngles: 1500,
      angle1: -49,
      angle2: 0,
      name: 'd',
    },
  ]

  const { offcutList, lumbersToCut, cutLumbersByTimberLengthId } =
    createCutList({
      lumbersToCut: initialLumbersToCut,
      offcutList: initialOffcutList,
      uuid: uuid,
    })
  expect(lumbersToCut).toEqual([])
  expect(cutLumbersByTimberLengthId).toEqual({
    '1': [
      {
        angleRelevantWidth: 90,
        depth: 35,
        lengthBeforeAngles: 2000,
        angle1: 0,
        angle2: 0,
        name: 'a',
        id: 1,
        timberLengthId: '1',
      },
      {
        angleRelevantWidth: 90,
        depth: 35,
        lengthBeforeAngles: 1500,
        angle1: 0,
        angle2: 45,
        name: 'b',
        id: 2,
        timberLengthId: '1',
      },
      {
        angleRelevantWidth: 90,
        depth: 35,
        lengthBeforeAngles: 1500,
        angle1: -49,
        angle2: 0,
        name: 'd',
        id: 3,
        timberLengthId: '1',
      },
    ],
    '2': [
      {
        angleRelevantWidth: 90,
        depth: 35,
        lengthBeforeAngles: 1000,
        angle1: -50,
        angle2: 0,
        name: 'c',
        id: 4,
        timberLengthId: '2',
      },
    ],
  })

  expect(offcutList).toEqual([
    {
      length: 886.22420266299,
      lastAngle: 0,
      angleRelevantWidth: 90,
      timberLengthId: '1',
    },
    {
      length: 4888.0750051859395,
      lastAngle: 50,
      angleRelevantWidth: 90,
      timberLengthId: '2',
    },
  ])
})
it('backToBack trapazodal cuts with deep angles that should fit into a singleLength only because angles are preserved', () => {
  const uuid = uuider()
  let initialOffcutList: Offcut[] = [
    {
      length: STANDARD_TIMBER_LENGTH,
      lastAngle: 0,
      angleRelevantWidth: 90,
      timberLengthId: uuid(),
    },
  ]

  const angleRelevantWidth = 90
  const cutOverlap = Math.tan((67 * Math.PI) / 180) * angleRelevantWidth

  // 25 is fudge factor to account for saw blade loss
  // all three should fit with with a little bit of left over
  const lengthOfEachCut = (STANDARD_TIMBER_LENGTH - 4 * cutOverlap - 45) / 3
  let initialLumbersToCut: LumberToCut[] = [
    {
      angleRelevantWidth,
      depth: 35,
      lengthBeforeAngles: lengthOfEachCut,
      angle1: 67,
      angle2: -67, // positive and negative angles is what makes them trapezoidal // but it shouldn't matter
      name: 'a',
    },
    {
      angleRelevantWidth,
      depth: 35,
      lengthBeforeAngles: lengthOfEachCut,
      angle1: 67,
      angle2: -67, // positive and negative angles is what makes them trapezoidal // but it shouldn't matter
      name: 'b',
    },
    {
      angleRelevantWidth,
      depth: 35,
      lengthBeforeAngles: lengthOfEachCut,
      angle1: 67,
      angle2: -67, // positive and negative angles is what makes them trapezoidal // but it shouldn't matter
      name: 'c',
    },
  ]

  const { offcutList, lumbersToCut, cutLumbersByTimberLengthId } =
    createCutList({
      lumbersToCut: initialLumbersToCut,
      offcutList: initialOffcutList,
      uuid,
    })
  expect(lumbersToCut).toEqual([])
  expect(cutLumbersByTimberLengthId).toEqual({
    '1': [
      {
        angleRelevantWidth: 90,
        depth: 35,
        lengthBeforeAngles: 1702.2977161011497,
        angle1: 67,
        angle2: -67,
        name: 'a',
        id: 1,
        timberLengthId: '1',
      },
      {
        angleRelevantWidth: 90,
        depth: 35,
        lengthBeforeAngles: 1702.2977161011497,
        angle1: 67,
        angle2: -67,
        name: 'b',
        id: 2,
        timberLengthId: '1',
      },
      {
        angleRelevantWidth: 90,
        depth: 35,
        lengthBeforeAngles: 1702.2977161011497,
        angle1: 67,
        angle2: -67,
        name: 'c',
        id: 3,
        timberLengthId: '1',
      },
    ],
  })

  expect(offcutList).toHaveLength(1)
  expect(offcutList).toEqual([
    {
      length: 21.966258012773956,
      lastAngle: 67,
      angleRelevantWidth: 90,
      timberLengthId: '1',
    },
  ])
})
it('backToBack parallelagram cuts with deep angles that should fit into a singleLength only because angles are preserved', () => {
  let initialOffcutList: Offcut[] = [
    {
      length: STANDARD_TIMBER_LENGTH,
      lastAngle: 0,
      angleRelevantWidth: 90,
      timberLengthId: '0',
    },
  ]
  const sortedDescOffcutById = initialOffcutList.sort(
    (a, b) => Number(b.timberLengthId) - Number(a.timberLengthId)
  )
  const maxId = Number(sortedDescOffcutById[0].timberLengthId)
  const uuid = uuider(maxId)

  const angleRelevantWidth = 90
  const cutOverlap = Math.tan((67 * Math.PI) / 180) * angleRelevantWidth

  // 25 is fudge factor to account for saw blade loss
  // all three should fit with with a little bit of left over
  const lengthOfEachCut = (STANDARD_TIMBER_LENGTH - 4 * cutOverlap - 45) / 3
  let initialLumbersToCut: LumberToCut[] = [
    {
      angleRelevantWidth,
      depth: 35,
      lengthBeforeAngles: lengthOfEachCut,
      angle1: 67,
      angle2: 67,
      name: 'a',
    },
    {
      angleRelevantWidth,
      depth: 35,
      lengthBeforeAngles: lengthOfEachCut,
      angle1: 67,
      angle2: 67,
      name: 'b',
    },
    {
      angleRelevantWidth,
      depth: 35,
      lengthBeforeAngles: lengthOfEachCut,
      angle1: 67,
      angle2: 67,
      name: 'c',
    },
  ]

  const { offcutList, lumbersToCut, cutLumbersByTimberLengthId } =
    createCutList({
      lumbersToCut: initialLumbersToCut,
      offcutList: initialOffcutList,
      uuid: uuid,
    })
  expect(lumbersToCut).toEqual([])
  expect(cutLumbersByTimberLengthId).toEqual({
    '0': [
      {
        angleRelevantWidth: 90,
        depth: 35,
        lengthBeforeAngles: 1702.2977161011497,
        angle1: 67,
        angle2: 67,
        name: 'a',
        id: 1,
        timberLengthId: '0',
      },
      {
        angleRelevantWidth: 90,
        depth: 35,
        lengthBeforeAngles: 1702.2977161011497,
        angle1: 67,
        angle2: 67,
        name: 'b',
        id: 2,
        timberLengthId: '0',
      },
      {
        angleRelevantWidth: 90,
        depth: 35,
        lengthBeforeAngles: 1702.2977161011497,
        angle1: 67,
        angle2: 67,
        name: 'c',
        timberLengthId: '0',
        id: 3,
      },
    ],
  })

  expect(offcutList).toHaveLength(1)
  expect(offcutList).toEqual([
    {
      length: 21.966258012773956,
      lastAngle: 67,
      angleRelevantWidth: 90,
      timberLengthId: '0',
    },
  ])
})
it('Should work with cut list from an actual execution', () => {
  let initialOffcutList: Offcut[] = [
    {
      length: STANDARD_TIMBER_LENGTH,
      lastAngle: 0,
      angleRelevantWidth: 90,
      timberLengthId: '0',
    },
  ]
  const sortedDescOffcutById = initialOffcutList.sort(
    (a, b) => Number(b.timberLengthId) - Number(a.timberLengthId)
  )
  const maxId = Number(sortedDescOffcutById[0].timberLengthId)
  const uuid = uuider(maxId)

  const angleRelevantWidth = 90
  const cutOverlap = Math.tan((67 * Math.PI) / 180) * angleRelevantWidth

  // 25 is fudge factor to account for saw blade loss
  // all three should fit with with a little bit of left over
  const lengthOfEachCut = (STANDARD_TIMBER_LENGTH - 4 * cutOverlap - 45) / 3
  let initialLumbersToCut: LumberToCut[] = [
    {
      angleRelevantWidth: 35,
      depth: 90,
      lengthBeforeAngles: 949.6869799080042,
      angle1: 40,
      angle2: 40,
      name: 'backPitchedStud',
    },
    {
      angleRelevantWidth: 35,
      depth: 90,
      lengthBeforeAngles: 949.6869799080042,
      angle1: 40,
      angle2: 40,
      name: 'backPitchedStud',
    },
    {
      angleRelevantWidth: 90,
      depth: 35,
      lengthBeforeAngles: 1544.3684870912048,
      angle1: 0,
      angle2: 40,
      name: 'frontCornerStudL',
    },
    {
      angleRelevantWidth: 90,
      depth: 35,
      lengthBeforeAngles: 1544.3684870912048,
      angle1: 0,
      angle2: 40,
      name: 'frontCornerStudL',
    },
    {
      angleRelevantWidth: 35,
      depth: 90,
      lengthBeforeAngles: 1770.9253875090703,
      angle1: 0,
      angle2: 40,
      name: 'lDoorVertStud',
    },
    {
      angleRelevantWidth: 35,
      depth: 90,
      lengthBeforeAngles: 1770.9253875090703,
      angle1: 0,
      angle2: 40,
      name: 'rDoorVertStud',
    },
    {
      angleRelevantWidth: 90,
      depth: 35,
      lengthBeforeAngles: 375,
      angle1: 0,
      angle2: 0,
      name: 'footL',
    },
    {
      angleRelevantWidth: 90,
      depth: 35,
      lengthBeforeAngles: 375,
      angle1: 0,
      angle2: 0,
      name: 'footR',
    },
    {
      angleRelevantWidth: 90,
      depth: 35,
      lengthBeforeAngles: 1715,
      angle1: 0,
      angle2: 0,
      name: 'doorSupportUnderHeaderL',
    },
    {
      angleRelevantWidth: 90,
      depth: 35,
      lengthBeforeAngles: 1715,
      angle1: 0,
      angle2: 0,
      name: 'doorSupportUnderHeaderR',
    },
    {
      angleRelevantWidth: 90,
      depth: 35,
      lengthBeforeAngles: 820,
      angle1: 0,
      angle2: 0,
      name: 'doorHeader1',
    },
    {
      angleRelevantWidth: 90,
      depth: 35,
      lengthBeforeAngles: 820,
      angle1: 0,
      angle2: 0,
      name: 'doorHeader2',
    },
    {
      angleRelevantWidth: 35,
      depth: 90,
      lengthBeforeAngles: 1515,
      angle1: 0,
      angle2: 40,
      name: 'vertStudsBetweenSideAndDoor',
    },
    {
      angleRelevantWidth: 35,
      depth: 90,
      lengthBeforeAngles: 1515,
      angle1: 0,
      angle2: 40,
      name: 'vertStudsBetweenSideAndDoor',
    },
    {
      angleRelevantWidth: 35,
      depth: 90,
      lengthBeforeAngles: 108.57232480920788,
      angle1: 0,
      angle2: 40,
      name: 'vertStudsOverDoor',
    },
    {
      angleRelevantWidth: 35,
      depth: 90,
      lengthBeforeAngles: 108.57232480920788,
      angle1: 0,
      angle2: 40,
      name: 'vertStudsOverDoor',
    },
  ]

  const { offcutList, lumbersToCut, cutLumbersByTimberLengthId } =
    createCutList({
      lumbersToCut: initialLumbersToCut,
      offcutList: initialOffcutList,
      uuid: uuid,
    })
  expect(lumbersToCut).toEqual([])
  expect(cutLumbersByTimberLengthId).toEqual({
    '0': [
      {
        angleRelevantWidth: 90,
        depth: 35,
        lengthBeforeAngles: 1715,
        angle1: 0,
        angle2: 0,
        name: 'doorSupportUnderHeaderL',
        id: 1,
        timberLengthId: '0',
      },
      {
        angleRelevantWidth: 90,
        depth: 35,
        lengthBeforeAngles: 1715,
        angle1: 0,
        angle2: 0,
        name: 'doorSupportUnderHeaderR',
        id: 2,
        timberLengthId: '0',
      },
      {
        angleRelevantWidth: 90,
        depth: 35,
        lengthBeforeAngles: 1544.3684870912048,
        angle1: 0,
        angle2: 40,
        name: 'frontCornerStudL',
        id: 3,
        timberLengthId: '0',
      },
      {
        angleRelevantWidth: 35,
        depth: 90,
        lengthBeforeAngles: 108.57232480920788,
        angle1: 0,
        angle2: 40,
        name: 'vertStudsOverDoor',
        id: 9,
        timberLengthId: '0',
      },
      {
        angleRelevantWidth: 35,
        depth: 90,
        lengthBeforeAngles: 108.57232480920788,
        angle1: 0,
        angle2: 40,
        name: 'vertStudsOverDoor',
        id: 10,
        timberLengthId: '0',
      },
      {
        angleRelevantWidth: 90,
        depth: 35,
        lengthBeforeAngles: 375,
        angle1: 0,
        angle2: 0,
        name: 'footL',
        id: 15,
        timberLengthId: '0',
      },
    ],
    '1': [
      {
        angleRelevantWidth: 90,
        depth: 35,
        lengthBeforeAngles: 1544.3684870912048,
        angle1: 0,
        angle2: 40,
        name: 'frontCornerStudL',
        id: 4,
        timberLengthId: '1',
      },
      {
        angleRelevantWidth: 35,
        depth: 90,
        lengthBeforeAngles: 1770.9253875090703,
        angle1: 0,
        angle2: 40,
        name: 'lDoorVertStud',
        id: 5,
        timberLengthId: '1',
      },
      {
        angleRelevantWidth: 35,
        depth: 90,
        lengthBeforeAngles: 1770.9253875090703,
        angle1: 0,
        angle2: 40,
        name: 'rDoorVertStud',
        id: 6,
        timberLengthId: '1',
      },
      {
        angleRelevantWidth: 90,
        depth: 35,
        lengthBeforeAngles: 375,
        angle1: 0,
        angle2: 0,
        name: 'footR',
        id: 16,
        timberLengthId: '1',
      },
    ],
    '2': [
      {
        angleRelevantWidth: 35,
        depth: 90,
        lengthBeforeAngles: 1515,
        angle1: 0,
        angle2: 40,
        name: 'vertStudsBetweenSideAndDoor',
        id: 7,
        timberLengthId: '2',
      },
      {
        angleRelevantWidth: 35,
        depth: 90,
        lengthBeforeAngles: 1515,
        angle1: 0,
        angle2: 40,
        name: 'vertStudsBetweenSideAndDoor',
        id: 8,
        timberLengthId: '2',
      },
      {
        angleRelevantWidth: 35,
        depth: 90,
        lengthBeforeAngles: 949.6869799080042,
        angle1: 40,
        angle2: 40,
        name: 'backPitchedStud',
        id: 11,
        timberLengthId: '2',
      },
      {
        angleRelevantWidth: 35,
        depth: 90,
        lengthBeforeAngles: 949.6869799080042,
        angle1: 40,
        angle2: 40,
        name: 'backPitchedStud',
        id: 12,
        timberLengthId: '2',
      },
      {
        angleRelevantWidth: 90,
        depth: 35,
        lengthBeforeAngles: 820,
        angle1: 0,
        angle2: 0,
        name: 'doorHeader1',
        id: 13,
        timberLengthId: '2',
      },
    ],
    '3': [
      {
        angleRelevantWidth: 90,
        depth: 35,
        lengthBeforeAngles: 820,
        angle1: 0,
        angle2: 0,
        name: 'doorHeader2',
        id: 14,
        timberLengthId: '3',
      },
    ],
  })

  expect(offcutList).toHaveLength(4)
  expect(offcutList).toEqual([
    {
      length: 308.7669656572259,
      lastAngle: 0,
      angleRelevantWidth: 90,
      timberLengthId: '0',
    },
    {
      length: 420.0608402575016,
      lastAngle: 0,
      angleRelevantWidth: 90,
      timberLengthId: '1',
    },
    {
      length: 115.40342621518221,
      lastAngle: 0,
      angleRelevantWidth: 90,
      timberLengthId: '2',
    },
    { length: 5177, lastAngle: 0, angleRelevantWidth: 90, timberLengthId: '3' },
  ])
})
