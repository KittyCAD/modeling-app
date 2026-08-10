import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  type ProjectLibrary,
} from '@src/lib/projectLibraries'
import { shouldShowFreeCloudProjectTrainingDisclosure } from '@src/lib/projectLibraries/trainingDisclosure'
import { describe, expect, it } from 'vitest'

function library(type: ProjectLibrary['type']): ProjectLibrary {
  return {
    id: `${type}-library`,
    title: 'Projects',
    path: '/projects',
    type,
  }
}

describe('shouldShowFreeCloudProjectTrainingDisclosure', () => {
  it('shows the disclosure for Free users viewing a cloud library', () => {
    expect(
      shouldShowFreeCloudProjectTrainingDisclosure({
        library: library(CLOUD_PROJECT_LIBRARY_TYPE),
        hasSubscription: false,
      })
    ).toBe(true)
  })

  it('hides the disclosure for paid users viewing a cloud library', () => {
    expect(
      shouldShowFreeCloudProjectTrainingDisclosure({
        library: library(CLOUD_PROJECT_LIBRARY_TYPE),
        hasSubscription: true,
      })
    ).toBe(false)
  })

  it('hides the disclosure until billing has loaded', () => {
    expect(
      shouldShowFreeCloudProjectTrainingDisclosure({
        library: library(CLOUD_PROJECT_LIBRARY_TYPE),
        hasSubscription: undefined,
      })
    ).toBe(false)
  })

  it('hides the disclosure for Free users viewing a directory library', () => {
    expect(
      shouldShowFreeCloudProjectTrainingDisclosure({
        library: library(DIRECTORY_PROJECT_LIBRARY_TYPE),
        hasSubscription: false,
      })
    ).toBe(false)
  })
})
