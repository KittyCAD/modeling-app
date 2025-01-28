export const SAW_BLADE_THICKNESS = 3 // 3mm loss per cut from saw blade on 90 degree cuts

export function uuider(start = 0) {
  let __uuid_cntr = start
  return () => {
    // but it's very fake
    __uuid_cntr++
    return String(__uuid_cntr)
  }
}

export type Offcut = {
  length: number
  lastAngle: number
  angleRelevantWidth: number
  timberLengthId: string
}

export type LumberToCut = {
  angleRelevantWidth: number
  depth: number
  lengthBeforeAngles: number
  angle1: number
  angle2: number
  name: string
}

export type CutLumber = LumberToCut & {
  id: number
  timberLengthId: string
}

export const STANDARD_TIMBER_LENGTH = 6_000

export function createCutList({
  lumbersToCut,
  offcutList,
  uuid,
}: {
  lumbersToCut: LumberToCut[]
  offcutList: Offcut[]
  uuid: () => string
}) {
  const uniqueAngles = new Set<number>()
  lumbersToCut.forEach((lumber) => {
    uniqueAngles.add(lumber.angle1)
    uniqueAngles.add(lumber.angle2)
  })
  let cutLumbers: CutLumber[] = []

  const lumberGetter = (
    lumbersToCut: LumberToCut[],
    lastOffcut: Offcut
  ): {
    lumber: LumberToCut
    newLumbersToCut: LumberToCut[]
  } => {
    // let longestLumberOfAngle: LumberToCut | undefined
    let longestLumberOfAngleIndex = -1
    lumbersToCut.forEach((lumberToCut, index) => {
      if (
        (Math.abs(lumberToCut.angle1) === Math.abs(lastOffcut.lastAngle) ||
          Math.abs(lumberToCut.angle2) === Math.abs(lastOffcut.lastAngle)) &&
        lastOffcut.angleRelevantWidth === lumberToCut.angleRelevantWidth
      ) {
        if (longestLumberOfAngleIndex === -1) {
          longestLumberOfAngleIndex = index
        } else {
          const currentLongest = lumbersToCut[longestLumberOfAngleIndex]
          if (
            currentLongest.lengthBeforeAngles < lumberToCut.lengthBeforeAngles
          ) {
            longestLumberOfAngleIndex = index
          }
        }
      }
    })
    if (longestLumberOfAngleIndex !== -1) {
      return {
        lumber: lumbersToCut[longestLumberOfAngleIndex],
        newLumbersToCut: lumbersToCut.filter(
          (_, index) => index !== longestLumberOfAngleIndex
        ),
      }
    }

    // didn't find lumber with matching angle,
    // so just get the longest lumber with whatever angle it happens to be
    let longestLumberIndex = 0
    lumbersToCut.forEach((lumberToCut, index) => {
      if (
        lumberToCut.lengthBeforeAngles >
        lumbersToCut[longestLumberIndex].lengthBeforeAngles
      ) {
        longestLumberIndex = index
      }
    })
    return {
      lumber: lumbersToCut[longestLumberIndex],
      newLumbersToCut: lumbersToCut.filter(
        (_, index) => index !== longestLumberIndex
      ),
    }
  }

  const cutLumberOutOfOffcuts = (
    lumber: LumberToCut,
    offcuts: Offcut[],
    lastId: number
  ): {
    cutLumber: CutLumber
    newOffcuts: Offcut[]
  } => {
    const doCalcsForGivenOffcutAndCurrentLumber = (
      offcut: Offcut,
      lumber: LumberToCut
    ) => {
      const getOverlap = (timberWidth: number, angleD: number) =>
        Math.abs(Math.tan((Math.abs(angleD) * Math.PI) / 180) * timberWidth)
      let angleThatMatchesClosestToOffcut = 0
      let endCutAngle = 0
      if (
        Math.abs(Math.abs(offcut.lastAngle) - Math.abs(lumber.angle1)) <
        Math.abs(Math.abs(offcut.lastAngle) - Math.abs(lumber.angle2))
      ) {
        angleThatMatchesClosestToOffcut = Math.abs(lumber.angle1)
        endCutAngle = Math.abs(lumber.angle2)
      } else {
        angleThatMatchesClosestToOffcut = Math.abs(lumber.angle2)
        endCutAngle = Math.abs(lumber.angle1)
      }
      const offCutOverLapZon = getOverlap(
        offcut.angleRelevantWidth,
        offcut.lastAngle
      )
      const lumberOverLapZon = getOverlap(
        lumber.angleRelevantWidth,
        angleThatMatchesClosestToOffcut
      )
      let overLapZoneBuffer = 0
      if (lumberOverLapZon - offCutOverLapZon > 0) {
        overLapZoneBuffer = lumberOverLapZon - offCutOverLapZon
      }
      const extraNeededAtOtherEndOfCut = getOverlap(
        lumber.angleRelevantWidth,
        endCutAngle
      )
      const sawCutLoss = Math.abs(
        SAW_BLADE_THICKNESS / Math.cos((Math.abs(endCutAngle) * Math.PI) / 180)
      )
      const minimumLengthNeeded =
        lumber.lengthBeforeAngles +
        overLapZoneBuffer +
        extraNeededAtOtherEndOfCut
      return {
        minimumLengthNeeded,
        lengthBeforeAngles: lumber.lengthBeforeAngles,
        overLapZoneBuffer,
        extraNeededAtOtherEndOfCut,
        sawCutLoss,
        endCutAngle: Math.abs(endCutAngle),
      }
    }
    const findIndexFn = (offcut: Offcut) => {
      const { minimumLengthNeeded } = doCalcsForGivenOffcutAndCurrentLumber(
        offcut,
        lumber
      )
      if (offcut.length >= minimumLengthNeeded) {
        return true
      }
      // none of the offcuts are big enough
      // need to add a new full length of timber as an offcut and try again.
      return false
    }
    let offCutToUseIndex = offcuts.findIndex(findIndexFn)

    let newOffcuts = offcuts
    if (offCutToUseIndex === -1) {
      const lastOffcut = offcuts[offcuts.length - 1]
      const newOffcut: Offcut = {
        length: STANDARD_TIMBER_LENGTH,
        lastAngle: 0,
        angleRelevantWidth: 90,
        timberLengthId: `${Number(lastOffcut.timberLengthId) + 1}`,
      }
      console.log('last and new offcut', offcuts[offcuts.length - 1], newOffcut)
      newOffcuts = [...offcuts, newOffcut]
      offCutToUseIndex = newOffcuts.length - 1
    }
    if (offCutToUseIndex === -1) {
      console.warn('offCutToUseIndex === -1')
      throw new Error('timber does not fit in any offcuts, even a fresh one')
    }

    const {
      lengthBeforeAngles,
      overLapZoneBuffer,
      extraNeededAtOtherEndOfCut,
      sawCutLoss,
      endCutAngle,
    } = doCalcsForGivenOffcutAndCurrentLumber(
      newOffcuts[offCutToUseIndex],
      lumber
    )

    const updatedOffcut: Offcut = {
      length:
        newOffcuts[offCutToUseIndex].length -
        lengthBeforeAngles -
        overLapZoneBuffer -
        extraNeededAtOtherEndOfCut -
        sawCutLoss,
      lastAngle: Math.abs(endCutAngle),
      angleRelevantWidth: lumber.angleRelevantWidth,
      timberLengthId: newOffcuts[offCutToUseIndex].timberLengthId,
    }
    newOffcuts[offCutToUseIndex] = updatedOffcut
    const cutLumber: CutLumber = {
      ...lumber,
      id: lastId + 1,
      timberLengthId: newOffcuts[offCutToUseIndex].timberLengthId,
    }
    return {
      cutLumber,
      newOffcuts,
    }
  }

  let currentId = 0

  while (lumbersToCut.length > 0) {
    const lastOffcut = offcutList[offcutList.length - 1]
    const result = lumberGetter(lumbersToCut, lastOffcut)
    lumbersToCut = result.newLumbersToCut
    const lumber = result.lumber
    const { cutLumber, newOffcuts } = cutLumberOutOfOffcuts(
      lumber,
      offcutList,
      currentId
    )
    offcutList = newOffcuts
    cutLumbers = [...cutLumbers, cutLumber]
    currentId = cutLumber.id
  }
  // group cutLumbers by timberLengthId
  const cutLumbersByTimberLengthId: Record<string, CutLumber[]> = {}
  cutLumbers.forEach((cutLumber) => {
    if (!cutLumbersByTimberLengthId[cutLumber.timberLengthId]) {
      cutLumbersByTimberLengthId[cutLumber.timberLengthId] = []
    }
    cutLumbersByTimberLengthId[cutLumber.timberLengthId].push(cutLumber)
  })

  return { cutLumbers, offcutList, lumbersToCut, cutLumbersByTimberLengthId }
}
