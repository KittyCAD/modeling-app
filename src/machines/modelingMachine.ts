import { PathToNode } from 'lang/wasm'
import { engineCommandManager } from 'lang/std/engineConnection'
import { isReducedMotion } from 'lang/util'
import {
  Axis,
  Selection,
  SelectionRangeTypeMap,
  Selections,
} from 'lib/selections'
import { assign, createMachine } from 'xstate'
import { v4 as uuidv4 } from 'uuid'
import { isCursorInSketchCommandRange } from 'lang/util'
import {
  doesPipeHaveCallExp,
  getNodePathFromSourceRange,
  hasExtrudeSketchGroup,
} from 'lang/queryAst'
import { kclManager } from 'lang/KclSinglton'
import {
  horzVertInfo,
  applyConstraintHorzVert,
} from 'components/Toolbar/HorzVert'
import {
  applyConstraintHorzVertAlign,
  horzVertDistanceInfo,
} from 'components/Toolbar/SetHorzVertDistance'
import { angleBetweenInfo } from 'components/Toolbar/SetAngleBetween'
import { angleLengthInfo } from 'components/Toolbar/setAngleLength'
import {
  applyConstraintEqualLength,
  setEqualLengthInfo,
} from 'components/Toolbar/EqualLength'
import { extrudeSketch } from 'lang/modifyAst'
import { getNodeFromPath } from '../lang/queryAst'
import { CallExpression, PipeExpression } from '../lang/wasm'
import { getConstraintLevelFromSourceRange } from 'lang/std/sketchcombos'
import {
  applyConstraintEqualAngle,
  equalAngleInfo,
} from 'components/Toolbar/EqualAngle'
import {
  applyRemoveConstrainingValues,
  removeConstrainingValuesInfo,
} from 'components/Toolbar/RemoveConstrainingValues'
import { intersectInfo } from 'components/Toolbar/Intersect'
import {
  absDistanceInfo,
  applyConstraintAxisAlign,
} from 'components/Toolbar/SetAbsDistance'
import { Models } from '@kittycad/lib/dist/types/src'

export const MODELING_PERSIST_KEY = 'MODELING_PERSIST_KEY'

export type SetSelections =
  | {
      selectionType: 'singleCodeCursor'
      selection?: Selection
    }
  | {
      selectionType: 'otherSelection'
      selection: Axis
    }
  | {
      selectionType: 'completeSelection'
      selection: Selections
    }
  | {
      selectionType: 'mirrorCodeMirrorSelections'
      selection: Selections
    }

export type ModelingMachineEvent =
  | { type: 'Deselect all' }
  | { type: 'Deselect edge'; data: Selection & { type: 'edge' } }
  | { type: 'Deselect axis'; data: Axis }
  | {
      type: 'Deselect segment'
      data: Selection & { type: 'line' | 'arc' }
    }
  | { type: 'Deselect face'; data: Selection & { type: 'face' } }
  | {
      type: 'Deselect point'
      data: Selection & { type: 'point' | 'line-end' | 'line-mid' }
    }
  | { type: 'Enter sketch' }
  | { type: 'Select all'; data: Selection & { type: 'all ' } }
  | { type: 'Select edge'; data: Selection & { type: 'edge' } }
  | { type: 'Select axis'; data: Axis }
  | { type: 'Select segment'; data: Selection & { type: 'line' | 'arc' } }
  | { type: 'Select face'; data: Selection & { type: 'face' } }
  | { type: 'Select default plane'; data: { planeId: string } }
  | { type: 'Set selection'; data: SetSelections }
  | {
      type: 'Select point'
      data: Selection & { type: 'point' | 'line-end' | 'line-mid' }
    }
  | { type: 'Sketch no face' }
  | { type: 'Toggle gui mode' }
  | { type: 'Cancel' }
  | { type: 'CancelSketch' }
  | {
      type: 'Add point'
      data: {
        coords: Models['Point2d_type'][]
        axis: 'xy' | 'xz' | 'yz' | '-xy' | '-xz' | '-yz' | null
        segmentId?: string
      }
    }
  | { type: 'Equip line tool'; data: Models['SceneToolType_type'] }
  | { type: 'Equip tangential arc tool2'; data: Models['SceneToolType_type'] }
  | { type: 'Equip move tool' }
  | { type: 'Set radius' }
  | { type: 'Complete line' }
  | { type: 'Set distance' }
  | { type: 'Equip new tool' }
  | { type: 'update_code'; data: string }
  | { type: 'Make segment horizontal' }
  | { type: 'Make segment vertical' }
  | { type: 'Constrain horizontal distance' }
  | { type: 'Constrain ABS X' }
  | { type: 'Constrain ABS Y' }
  | { type: 'Constrain vertical distance' }
  | { type: 'Constrain angle' }
  | { type: 'Constrain perpendicular distance' }
  | { type: 'Constrain horizontally align' }
  | { type: 'Constrain vertically align' }
  | { type: 'Constrain snap to X' }
  | { type: 'Constrain snap to Y' }
  | { type: 'Constrain length' }
  | { type: 'Constrain equal length' }
  | { type: 'Constrain parallel' }
  | { type: 'Constrain remove constraints' }
  | { type: 'extrude intent' }
  | { type: 'Re-execute' }

export const modelingMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogDMAVgDsAOmEiAjLMGCAHIIAsAJlHKANCACeiaQDZBEsctGrVATmmiaNQQF8H2tBhz5x2CJjAEAymDsAASwWGDknNy0DEggLGyRPLECCAYW4gaWogrZllaC0sLC2noI0qoG0uLyUpkFqsqZwk4u6Fh4UJ7evgAicGERQSx47NG88RxcSaApggbCkjTZS8rKRcoKNMW6+tKK4hWWBgbKImpWqi0gru0eXj4EfaE+g5AwY7ETibyzx+JLCj2tkawjMWRK+ho0mU4gURlOwiheWsl2c1za7k6916-RewRIfGwsA+zFYk24PyE5nEokRdjy6nmcwMEIQCms4jW5i2BgUCMcaJumK6DwCeKGqBGJLiZO+yUQyi24kMokslgKlnZokMLJ2CDUNE5m1EGtUgiheyuQo6It8YvCwTeYGlXymlP1NAURtO7LhoPBepOMKDgKWe1BymkVoxNux-gG+MJxPo41lbvl+sEqgyNHVeUR0ksNEyrNBXsLhkswlU0OEvIFrTcse68fFADMSJQXWmKRnFV6DHY1HNzeqoazREZYUdCnDizlhApo027i2AKK4dhgABOIQA1oFyAALbsJdMzXaR8SWRqRm9AwQB0pm4OF2nzKuaqTKZe3LHrzcd33Q8T2kGJSTPXsL1SJQaUBLJpDsVRAW2UoDQyHJHw0SolgsX9hTjJ4EyCDsuxTT4e2mfgqUNIxkPUR9F2w1lzSqYx1SMG96MyfDm1FYiSEwTBT3JKiUkjQQDgqMQ+VUOwilQxA5JhPI0g2VZFGERDUUbP9bUeXEHSCQThPIiDRPdRQqlvJRVRoGtDFZQFJDkuwCj5aFBwbdEV3-B4wD4dhtwAVwwIIRjATcRLlaDlDyZU5hfWlqxvUFWVnCQ1WyDQVCUQEf0FGNV38wKQrCiKorA1NILEhUOXZIMa1c2QtnSjY2O1YtHzkvkFB0ny9L8A92GPYgyEoTAhpA6Lz2ohAszsGlH0LNJpHZOtBHSqEYX7ews3KNU+t4jwppGo9xFO48AEkW3tQZhiisyZRqyy5lo6FI0jVQimyXVSiKNi8j9G8jEtQrfIu4bj0hkCbv48VQigABbSLRie10oLm+RBwyD7oXKH7LFZSMJFYqtc0MQE8PBwaofOy6jzhnFniMh60fA56LIzeQbAyYw4REAGjFEVlkMsaoUs9dQVRoRpjs6BmYbOpmDJZwZEZRx6OYx2r5vNL0jk1BR1g2Jj0rra9lpNLZ1CWdV5aV6GGZVtcAEdguwJggncMAgnYVBUFM7XKMsuFs3KBzjG6x90pUTlVV5DY8nsNYHcV5313dz2-bIGBN2wQTjO3cg-YDoPqq56DTGzc05K0uLGmLUtxYqNRGhUDRFSONO6cdxnM49r2kdQAA3X3-cDmbMfE0FsyRApF2EIsji277-iNkRDs9ase5AvuVYCYI1cSKfdZUT1qlltQl8BNIn0QJRDWyWQFFf+8TQMXezv3ltkBIA8QhgGRqjIIY9tycHIIJU+ll1ALGNnsBostNRZk2nqco5R-g5UULLTINhmg02FOnOmKs-4AI1iAo8qBtzYAAF7cHYFA9GIdubfRbqIWw+VshiFQaUWQiFqjNU+lpdkBVdKEN7hnB4RBuCwCCiQPAQRKHULoZuQuEAiQMIoM6JhL0WFzAOGqBaYh7KrD+kpCwA4ayKhOK3RQX8nbEJbNI3AsjtzyNwKAncEC1EaPGto4OujoJZi0gcXMYdjAnFzIpBANZizr3pCsNY1h7H00cVImRciFEAEEABCfgggAA1oEsIMBITIaxvrHGODYEWep1A5BchUY2hirCWBST-dJLjMkeNyfkgAmsUoJFQJBxWsCab6YTHJ1LyFUKwtZaSTmLG0ghNoiGwycRktxCjc4+EGVjYJGR+yPgKCIWWPClLyHFn1VYtkGgE3wWI1ZEi0m+Gca49x3tIpQHYCeHRld9mFgyBYSompSknGkKLNYbERAoJRIYb67TJGvM2R8pgO40W4HUeQYKmASC7nUbIvxezZixJpBtM0QI1pmJiScCQyFFz2Fwew+QiKXnEBRQopRtD6EmR0MZHAUBcDEqEA0EwhxKjanQaoWOhRMFQkHHczItJWXrM6e8hRYDvFCT5YJbAgrhXzVbsqKEgtX4WDsNS6EDRqjgr4QhJqKrlYbK6VsjxsBcAkC9v7QpBqsxZEthY78ipVhaDQXyQ0aosoojsMWURA1xF7yReyl1Hz3WetLkEAZfyYpYysBITuqpIz2WXtEwsjQBHmkUKcQompRCOuus69VHiwDu0Lj4fAPzfX1OVEoSpYYthEzQSlUJjQCa2FsN5a0J1nmquRSmhRTA8UmWoNm2aswChVFwYhVUS8LDnLKCaOBKwNCInUmaet-c1XdKCNuMAw8x5BHIByzcyYAn-JJfIA4mx1StzVMLdKd8aQoj9WYc1cap0KxnU6h4AAlMAABaAK4Rgpbl9fICQmxZbFkHDyJugZnKyDWJsNauZgQXpdlnL1udUYF0wEXEuE9MCqANYqCokgVDdQBOyM0scdqqnHYiSW2R2kABk8C+wACplwIG7QeQR73jzLixvkbCG6Km3YuJyUgyXsKhXg1UyzHnTr3mJ3AknpNwcQ3wZDqHV3TwVAWaoihaU4ZOIO3hVgaQIjMMbcwmpNSifE0EKTgdxAAAVJSbiCFkiAGAIAEBixACUUo7O6zWKCZUz9oSjnMBCwMNZOSt1BDzRcYMjOQZM0FkLmALpAM1sERLkAEuxeS1rCuOaZ5FmvI0Qc8E1qyGJtpwwhRzCgnkkoQLZngtl1q8AqLjX4vSKRkwHwW5vbiZY1kBYnFa7WIsNKwMF9Vi1vMJsdkSxJvmdCwEObDXYtNdk9nTRedOCFzxQxsuzHUvunauLbUDLETBJrNE0dkgThLykI+Ks4GioVe-qZq7NWrq4A4AQX1P7-hnefryJVpZVQZEnGaJQp6hyXem6F5HqOqBVQooErGRYDCwjO360cWl90nEZ0yeynpSmVsnbDvu4gEfk5qwAOVQEECLIxYDNaS2zFj6h80ms9GYIw7JWRBk5PYeytKturHaRJ6j+dBJZOLiLmTlH5Oj0U5Pb7GYKyc6OLyV+0IbxzFZPBwwsIzDuXsEoLIpx+oQcF4b-ANGTdm+q+FyLd24uy9a+zdra7EAnE-Uc2kEcciln0a-XdKoCiHoN0b17mBTclyjzd+r0X7vxcSwng1xxtPqb-Y+RoNZBuvjiuYRvpTX5F7D8b0vkeZuV5AQt9ly3Vu+x9g3vIkkthqCOH1LYKhSxmi1+qKQn4RDzH7y92jZeRezar+Px7XszMAHdS627fR1lP9Z-hqEPTjvYLExDKjrDeI43fQR7-D0P8vGbSndgNHO3KufjWEQsHIKWTUHjPUOKL0YwPYeyBaLCB5eNJ5PeUPffCPQAinFHEA6nW-ZPBAGSQ0asb6Y0OsdkPLf6HGSNOwDQK1FOP-QfQ-KPcXSXGPGXOveXMAuaSoWVXkOsbUW8FQNYUsJeWENSTYHfJOfnCGRWNAB9areMI+BMKYA1LSZCDCSND6KsVfPUW+THOEV+dkDuJedpZQxHAgSzJDbFWzYg+zUgytWEWwO2XkKwBQCcdkBKdYOSPYPqLSKw63I-aw8KAg0Apw3WQTayMWAsewKsWkdKIEaoDYE9QxWWIPAXJQ0IqPcIvAKnGncyO-fUVKWEZCIwXrZzfdcoRaGsY4ByPhdLEIlQmbAoyIqgVQaI90U9cWXdVSLYKQWWdKCoaFL-YEBiGHRQ3uLJC-eRYILlFRBhOjAlTRSgCItsVAAgCAbgMATwXAEeVAA8cQGAdgeDJYnlTAeDPALYhXOEGkFOZSWkWuUWb6bMSMHIOZOYRcbImYveOYhYxRKhblVRVY3xLRTY7YncbcKhcQFbEgdgLY7cJGU4wIC4kE5YwSG43AO4-g8SZCUmUQ81TYSoaJCwaEHMeYLqVyOEOtFZYzb+QEjgTxcBbASBcEwlSE247Y3YszA4o4k4s4+DTVdk7EnkhXG8aoG8PqFqb6NaUWWQRnVYWQUrIcAPdpZk4IUUjkoINYvxKEggGEuEhEpEqhVE4UnU8U3E1ASUhYYsRkNUPheYUWFYJaQoT0QWSoaY2mAE+Ylk3pQpQ0vk-YvAQU-Y4UkgAAI1gHgz4BxLxJ6L7FaX+ELChC8PO3JMLUeLojNEjWrE-gZLh2hi1OizySDJ5KNO3FhO3HhNxTNJRLRPOOjNjPjIlPxIVBTMyE9Dd0oJNFFg0ANgaCKCLG5Byk1P9Ia3LL6WDL2IFOOIjPRJbPgx0ATNtI7P1C8NxkZCqUaDVFFiLENFjWNnmEB1VAUN9KZMnLLP6UNONNrNNORItKXJjJXLXMlJbj5BOEwx1FqWfD-T5iKE8KpSyD+MvJLOvJ2V9krJDPnKFKXPwB8HfI3MX36NKySSrEZFFkUHFjikiW1ApXVB9ITSvKBKgrvOrJNPrKfKbPgyguQqTNinNAjUEMUBPJrD-IuTigJxvEJxsGNgaAnKBPbW+SPFnP5LDIXNopEp+QYqT2cMXzKRESQSiWQlFi0jKQuDND9T9yEpZJkrEsrPvLrMRJouFIMrktp3fU7M1Alg-nO3Yk4piTMAWAsUYg0kQmhD0uCDRW3AxSxRxTxT1IhI2JgrnMkvgvON8v8vZMCu3Hg31K0UspKJILblcsKBqBEEwycukkyijlG2OHgW8qGHRUigCtxXxRCugptKrJrJMobOfKitKsxVioqoSqquSs5lKLSoOAyphQZSWFFkHHFnVBNAKuEKjCLL7iCFwAl1IjtGIgwA7BxR8txTMwNT2DVHXkQjomvmyxYilPsknAUikD2ELAdhIEnI6EATxCmDUJuodE0I3J2qqDsknC-NtVLTrBhEWSTlfknBlIdmPHCD3GuuPjuo2pJgOG+q5AqCOvNjSG9HUz2EHEjCBqPBBrBo0O4DR2KK6pIPxmDHqHHQQL3Lam00qBUCXjn09HsicDRFmowHgFiAg3krPlzHYy0jkEUBUHUFDVKHgyJ290PRyD6msDrAdmxDZp+0Rq32LABu1HhFqJHGVCsHpDWnyhZSmoZmlvt1MIyCdzMNd1OGpU9xCQ7jFkfFfmOA0HI26F1qCR5sth0uhCUEVH3TVAjVpoytOGCUMwwMZOhmF2qwdqxnYQWGwTMPcOrBYnmAyDJMXzmA2F321t7mDpmx6D2NDpSGrH2FNWMTigJg11OAyGGNHSaGyjJyjyl3mxr2zoVEjCqDWiXkMGwUaOLpUm13ELUCBH9uD0VnTuuzqzHzrqsu6veskD5A2BUBRrw1KE1yLErRDRrHYirqAIIPrvmj6kkkjv+vkgO3nv2GTrmDVDkiLCkDXtC04JrvYGZpSoUsKBhAsFA3KEHDWnZ1WGvG11bn4wjFYJL3YLLk3o2gWDb0nGpLSBGLqUyFLsyFcm7NlMLPKxD2LwP2H1C0zrM03u1AeOQnOxBWQWiSKAHHKDihEAsBHOIswO-mwP-0AdCxvurzi03rSGyEkCYI53slVMkKuRkPsG+vMP-rQbwJq1H1ruYbHpIOOBLo2nqEaC-J4ekIaFkIEZvCEdwKP2AOAYfzAcbwdKgf+kXC819BHJNC8tTqwNQY0Y4IlxvrvvxucKXknFTLFgNDSEUbDg2H4e-Ptgse-nCJDskYUryiBW0rSG3tajQRjUkFrT5t5GyHZFaMR3EA6I4E3o2AeLSDCfonNFLXDHXhyGtlO1zqSbCNCIvw4EoRQxvQQ3sJQzAGAeByBSWDpGxhXjQXybCQ0FsEXtzCocDvOgCfaPKcqaCDqa3Ead5mUjILijGJSP9SdyyZ6gklKZsatzHkmfzVUmfliThFGKkJ7OIc8qXmOGKsuLBOCq5NCptM3s0loiyH8xuSiTeOtWsDqOOB+KOHQP7tmOvKtM5PWOqq2NubhB2hsBMWlkqBOFdL6hibsByF9pyF5GKsDIKShJBdpDSO2npA0AqAHJOH+GBWsGQSrRRenPRaCbPgRbggjG+kYjpdFi1CA08h3wTuKvIp5IxYw2gNBD2E0jUGwqvBwsnBGwbl8eQcVlLIMopfvqpepGOC2GOtBFwXJL3LsvMI52yDApIogqBOirKtaqCsSuueBcpdDkfH+CkC0msFYzNSGspPpWOvKHqEMBSRmrms7AabNYzCXyWgLBoPJncfgKWGlPDRnG0kmuQcuoWKxtusxh1ndGpe-23iBkKFKXNgaSygRdyisn6c6GBvIFBvwAeoiFmgTft32zBwQPKGyDIfc30F+OVEKDwVjSlnpocCAA */
    id: 'Modeling',

    tsTypes: {} as import('./modelingMachine.typegen').Typegen0,
    predictableActionArguments: true,
    preserveActionOrder: true,

    context: {
      guiMode: 'default',
      tool: null as Models['SceneToolType_type'] | null,
      selection: [] as string[],
      selectionRanges: {
        otherSelections: [],
        codeBasedSelections: [],
      } as Selections,
      selectionRangeTypeMap: {} as SelectionRangeTypeMap,
      sketchPathToNode: null as PathToNode | null, // maybe too specific, and we should have a generic pathToNode, but being specific seems less risky when I'm not sure
      sketchEnginePathId: '' as string,
      sketchPlaneId: '' as string,
    },

    schema: {
      events: {} as ModelingMachineEvent,
    },

    states: {
      idle: {
        on: {
          'Set selection': {
            target: 'idle',
            internal: true,
            actions: 'Set selection',
          },

          'Deselect point': {
            target: 'idle',
            internal: true,
            actions: [
              'Remove from code-based selection',
              'Update code selection cursors',
              // 'Engine: remove highlight',
            ],
            cond: 'Selection contains point',
          },

          'Deselect edge': {
            target: 'idle',
            internal: true,
            actions: [
              'Remove from code-based selection',
              'Update code selection cursors',
              // 'Engine: remove highlight',
            ],
            cond: 'Selection contains edge',
          },

          'Deselect axis': {
            target: 'idle',
            internal: true,
            actions: [
              'Remove from other selection',
              'Update code selection cursors',
              // 'Engine: remove highlight',
            ],
            cond: 'Selection contains axis',
          },

          'Select point': {
            target: 'idle',
            internal: true,
            actions: [
              'Add to code-based selection',
              'Update code selection cursors',
              // 'Engine: add highlight',
            ],
          },

          'Select edge': {
            target: 'idle',
            internal: true,
            actions: [
              'Add to code-based selection',
              'Update code selection cursors',
              // 'Engine: add highlight',
            ],
          },

          'Select axis': {
            target: 'idle',
            internal: true,
            actions: [
              'Add to other selection',
              // 'Engine: add highlight',
            ],
          },

          'Select face': {
            target: 'idle',
            internal: true,
            actions: [
              'Add to code-based selection',
              'Update code selection cursors',
              // 'Engine: add highlight',
            ],
          },

          'Enter sketch': [
            {
              target: 'Sketch',
              cond: 'Selection is one face',
              actions: [
                'set sketch metadata',
                'sketch mode enabled',
                'edit mode enter',
              ],
            },
            'Sketch no face',
          ],

          'Deselect face': {
            target: 'idle',
            internal: true,
            actions: [
              'Remove from code-based selection',
              'Update code selection cursors',
              // 'Engine: remove highlight',
            ],
            cond: 'Selection contains face',
          },

          'Select all': {
            target: 'idle',
            internal: true,
            actions: 'Add to code-based selection',
          },

          'Deselect all': {
            target: 'idle',
            internal: true,
            actions: [
              'Clear selection',
              'Update code selection cursors',
              // 'Engine: remove highlight',
            ],
            cond: 'Selection is not empty',
          },

          'extrude intent': [
            {
              target: 'awaiting selection',
              cond: 'has no selection',
            },
            {
              target: 'idle',
              cond: 'has valid extrude selection',
              internal: true,
              actions: 'AST extrude',
            },
          ],
        },
      },

      Sketch: {
        states: {
          SketchIdle: {
            on: {
              'Select point': {
                target: 'SketchIdle',
                internal: true,
                actions: [
                  'Update code selection cursors',
                  'Add to code-based selection',
                ],
              },

              'Select segment': {
                target: 'SketchIdle',
                internal: true,
                actions: [
                  'Update code selection cursors',
                  'Add to code-based selection',
                ],
              },

              'Deselect point': {
                target: 'SketchIdle',
                internal: true,
                cond: 'Selection contains point',
                actions: [
                  'Update code selection cursors',
                  'Add to code-based selection',
                ],
              },

              'Deselect segment': {
                target: 'SketchIdle',
                internal: true,
                cond: 'Selection contains line',
                actions: [
                  'Update code selection cursors',
                  'Add to code-based selection',
                ],
              },

              'Equip line tool': {
                target: 'Line Tool',
                actions: 'set tool line',
              },

              'Equip tangential arc tool': {
                target: 'TangentialArc Tool',
                actions: 'set tool tangential arc',
              },

              'Equip move tool': 'Move Tool',

              'Set selection': {
                target: 'SketchIdle',
                internal: true,
                actions: 'Set selection',
              },

              'Make segment vertical': {
                cond: 'Can make selection vertical',
                target: 'SketchIdle',
                internal: true,
                actions: ['Make selection vertical'],
              },

              'Make segment horizontal': {
                target: 'SketchIdle',
                internal: true,
                cond: 'Can make selection horizontal',
                actions: ['Make selection horizontal'],
              },

              'Constrain horizontal distance': {
                target: 'Await horizontal distance info',
                cond: 'Can constrain horizontal distance',
              },

              'Constrain vertical distance': {
                target: 'Await vertical distance info',
                cond: 'Can constrain vertical distance',
              },

              'Constrain ABS X': {
                target: 'Await ABS X info',
                cond: 'Can constrain ABS X',
              },

              'Constrain ABS Y': {
                target: 'Await ABS Y info',
                cond: 'Can constrain ABS Y',
              },

              'Constrain angle': {
                target: 'Await angle info',
                cond: 'Can constrain angle',
              },

              'Constrain length': {
                target: 'Await length info',
                cond: 'Can constrain length',
              },

              'Constrain perpendicular distance': {
                target: 'Await perpendicular distance info',
                cond: 'Can constrain perpendicular distance',
              },

              'Constrain horizontally align': {
                cond: 'Can constrain horizontally align',
                target: 'SketchIdle',
                internal: true,
                actions: ['Constrain horizontally align'],
              },

              'Constrain vertically align': {
                cond: 'Can constrain vertically align',
                target: 'SketchIdle',
                internal: true,
                actions: ['Constrain vertically align'],
              },

              'Constrain snap to X': {
                cond: 'Can constrain snap to X',
                target: 'SketchIdle',
                internal: true,
                actions: ['Constrain snap to X'],
              },

              'Constrain snap to Y': {
                cond: 'Can constrain snap to Y',
                target: 'SketchIdle',
                internal: true,
                actions: ['Constrain snap to Y'],
              },

              'Constrain equal length': {
                cond: 'Can constrain equal length',
                target: 'SketchIdle',
                internal: true,
                actions: ['Constrain equal length'],
              },

              'Constrain parallel': {
                target: 'SketchIdle',
                internal: true,
                cond: 'Can canstrain parallel',
                actions: ['Constrain parallel'],
              },

              'Constrain remove constraints': {
                target: 'SketchIdle',
                internal: true,
                cond: 'Can constrain remove constraints',
                actions: ['Constrain remove constraints'],
              },

              'Re-execute': {
                target: 'SketchIdle',
                internal: true,
                actions: [
                  'set sketchMetadata from pathToNode',
                  'sketch mode enabled',
                  'edit mode enter',
                ],
              },

              'Equip tangential arc tool2': {
                target: 'Line Tool',
                cond: 'is editing existing sketch',
                actions: 'set tool line',
              },
            },

            entry: 'equip select',
          },

          'Line Tool': {
            states: {
              Done: {
                type: 'final',
              },

              'Point Added': {
                on: {
                  'Add point': {
                    target: 'Segment Added',
                    actions: ['AST start new sketch'],
                  },
                },
              },

              'Segment Added': {
                on: {
                  'Add point': {
                    target: 'Segment Added',
                    internal: true,
                    actions: ['AST add line segment'],
                  },

                  'Complete line': {
                    target: 'Done',
                    actions: ['Modify AST', 'Update code selection cursors'],
                  },

                  'Equip tangential arc tool2': {
                    target: 'Segment Added',
                    internal: true,
                    actions: 'set tool line',
                  },
                },
              },

              Init: {
                always: [
                  {
                    target: 'Segment Added',
                    cond: 'is editing existing sketch',
                  },
                  'No Points',
                ],
              },

              'No Points': {
                on: {
                  'Add point': 'Point Added',
                },
              },
            },

            // invoke: [
            //   {
            //     src: 'createLine',
            //     id: 'Create line',
            //     onDone: 'SketchIdle',
            //   },
            // ],
            initial: 'Init',

            on: {
              'Equip move tool': 'Move Tool',
              'Re-execute': {
                target: 'Line Tool',
                internal: true,
                actions: [
                  'set sketchMetadata from pathToNode',
                  'sketch mode enabled',
                  'edit mode enter',
                ],
              },
            },
          },

          'TangentialArc Tool': {
            states: {
              Done: {
                type: 'final',
              },

              'Point Added': {
                on: {
                  'Add point': {
                    target: 'Segment Added',
                    actions: ['AST start new sketch'],
                  },
                },
              },

              'Segment Added': {
                on: {
                  'Add point': {
                    target: 'Segment Added',
                    internal: true,
                    actions: ['AST add tangential arc segment'],
                  },

                  'Complete line': {
                    target: 'Done',
                    actions: ['Modify AST', 'Update code selection cursors'],
                  },

                  'Equip new tool': {
                    target: 'Segment Added',
                    internal: true,
                    actions: 'set tool tangential arc',
                  },
                },
              },

              Init: {
                always: [
                  {
                    target: 'Segment Added',
                    cond: 'is editing existing sketch',
                  },
                  'No Points',
                ],
              },

              'No Points': {
                on: {
                  'Add point': 'Point Added',
                },
              },
            },

            // invoke: [
            //   {
            //     src: 'createLine',
            //     id: 'Create line',
            //     onDone: 'SketchIdle',
            //   },
            // ],
            initial: 'Init',

            on: {
              'Equip move tool': 'Move Tool',
            },
          },

          'Move Tool': {
            entry: 'set tool move',

            on: {
              'Set selection': {
                target: 'Move Tool',
                internal: true,
                actions: 'Set selection',
              },

              'Re-execute': {
                target: 'Move Tool',
                internal: true,
                actions: [
                  'set sketchMetadata from pathToNode',
                  'sketch mode enabled',
                  'edit mode enter',
                ],
              },
            },

            states: {
              'Move init': {
                always: [
                  {
                    target: 'Move without re-execute',
                    cond: 'can move',
                  },
                  {
                    target: 'Move with execute',
                    cond: 'can move with execute',
                  },
                  'No move',
                ],
              },
              'Move without re-execute': {},
              'Move with execute': {},
              'No move': {},
            },

            initial: 'Move init',
          },

          'Await horizontal distance info': {
            invoke: {
              src: 'Get horizontal info',
              id: 'get-horizontal-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
              onError: 'SketchIdle',
            },
          },

          'Await vertical distance info': {
            invoke: {
              src: 'Get vertical info',
              id: 'get-vertical-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
              onError: 'SketchIdle',
            },
          },

          'Await ABS X info': {
            invoke: {
              src: 'Get ABS X info',
              id: 'get-abs-x-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
              onError: 'SketchIdle',
            },
          },

          'Await ABS Y info': {
            invoke: {
              src: 'Get ABS Y info',
              id: 'get-abs-y-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
              onError: 'SketchIdle',
            },
          },

          'Await angle info': {
            invoke: {
              src: 'Get angle info',
              id: 'get-angle-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
              onError: 'SketchIdle',
            },
          },

          'Await length info': {
            invoke: {
              src: 'Get length info',
              id: 'get-length-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
              onError: 'SketchIdle',
            },
          },

          'Await perpendicular distance info': {
            invoke: {
              src: 'Get perpendicular distance info',
              id: 'get-perpendicular-distance-info',
              onDone: {
                target: 'SketchIdle',
                actions: 'Set selection',
              },
              onError: 'SketchIdle',
            },
          },
        },

        initial: 'SketchIdle',

        on: {
          CancelSketch: '.SketchIdle',
        },

        exit: 'sketch exit execute',
      },

      'Sketch no face': {
        entry: 'show default planes',

        exit: 'hide default planes',
        on: {
          'Select default plane': {
            target: 'Sketch.SketchIdle',
            actions: [
              'reset sketch metadata',
              'set default plane id',
              'sketch mode enabled',
              'create path',
            ],
          },
        },
      },

      'awaiting selection': {
        on: {
          'Set selection': {
            target: 'checking selection',
            actions: 'Set selection',
          },
        },
      },

      'checking selection': {
        always: [
          {
            target: 'idle',
            cond: 'has valid extrude selection',
            actions: 'AST extrude',
          },
          {
            target: 'idle',
            actions: 'toast extrude failed',
          },
        ],
      },
    },

    initial: 'idle',

    on: {
      Cancel: {
        target: 'idle',
        // TODO what if we're existing extrude equipped, should these actions still be fired?
        // maybe cancel needs to have a guard for if else logic?
        actions: [
          'edit_mode_exit',
          'default_camera_disable_sketch_mode',
          'reset sketch metadata',
        ],
      },
    },
  },
  {
    guards: {
      'is editing existing sketch': ({ sketchPathToNode }) =>
        !!sketchPathToNode,
      'Can make selection horizontal': ({ selectionRanges }) =>
        horzVertInfo(selectionRanges, 'horizontal').enabled,
      'Can make selection vertical': ({ selectionRanges }) =>
        horzVertInfo(selectionRanges, 'vertical').enabled,
      'Can constrain horizontal distance': ({ selectionRanges }) =>
        horzVertDistanceInfo({ selectionRanges, constraint: 'setHorzDistance' })
          .enabled,
      'Can constrain vertical distance': ({ selectionRanges }) =>
        horzVertDistanceInfo({ selectionRanges, constraint: 'setVertDistance' })
          .enabled,
      'Can constrain ABS X': ({ selectionRanges }) =>
        absDistanceInfo({ selectionRanges, constraint: 'xAbs' }).enabled,
      'Can constrain ABS Y': ({ selectionRanges }) =>
        absDistanceInfo({ selectionRanges, constraint: 'yAbs' }).enabled,
      'Can constrain angle': ({ selectionRanges }) =>
        angleBetweenInfo({ selectionRanges }).enabled ||
        angleLengthInfo({ selectionRanges, angleOrLength: 'setAngle' }).enabled,
      'Can constrain length': ({ selectionRanges }) =>
        angleLengthInfo({ selectionRanges }).enabled,
      'Can constrain perpendicular distance': ({ selectionRanges }) =>
        intersectInfo({ selectionRanges }).enabled,
      'Can constrain horizontally align': ({ selectionRanges }) =>
        horzVertDistanceInfo({ selectionRanges, constraint: 'setHorzDistance' })
          .enabled,
      'Can constrain vertically align': ({ selectionRanges }) =>
        horzVertDistanceInfo({ selectionRanges, constraint: 'setHorzDistance' })
          .enabled,
      'Can constrain snap to X': ({ selectionRanges }) =>
        absDistanceInfo({ selectionRanges, constraint: 'snapToXAxis' }).enabled,
      'Can constrain snap to Y': ({ selectionRanges }) =>
        absDistanceInfo({ selectionRanges, constraint: 'snapToYAxis' }).enabled,
      'Can constrain equal length': ({ selectionRanges }) =>
        setEqualLengthInfo({ selectionRanges }).enabled,
      'Can canstrain parallel': ({ selectionRanges }) =>
        equalAngleInfo({ selectionRanges }).enabled,
      'Can constrain remove constraints': ({ selectionRanges }) =>
        removeConstrainingValuesInfo({ selectionRanges }).enabled,
      'has no selection': ({ selectionRanges }) => {
        if (selectionRanges?.codeBasedSelections?.length < 1) return true
        const selection = selectionRanges?.codeBasedSelections?.[0] || {}

        return (
          selectionRanges.codeBasedSelections.length === 1 &&
          !hasExtrudeSketchGroup({
            ast: kclManager.ast,
            programMemory: kclManager.programMemory,
            selection,
          })
        )
      },
      'has valid extrude selection': ({ selectionRanges }) => {
        if (selectionRanges.codeBasedSelections.length !== 1) return false
        const isSketchPipe = isCursorInSketchCommandRange(
          engineCommandManager.artifactMap,
          selectionRanges
        )
        const common = {
          selection: selectionRanges.codeBasedSelections[0],
          ast: kclManager.ast,
        }
        const hasClose = doesPipeHaveCallExp({ calleeName: 'close', ...common })
        const hasExtrude = doesPipeHaveCallExp({
          calleeName: 'extrude',
          ...common,
        })
        return !!isSketchPipe && hasClose && !hasExtrude
      },
      'can move': ({ selectionRanges }) =>
        // todo check all cursors are also in the right sketch
        selectionRanges.codeBasedSelections.every(
          (selection) =>
            getConstraintLevelFromSourceRange(
              selection.range,
              kclManager.ast
            ) === 'free'
        ),
      'can move with execute': ({ selectionRanges }) =>
        // todo check all cursors are also in the right sketch
        selectionRanges.codeBasedSelections.every((selection) =>
          ['partial', 'free'].includes(
            getConstraintLevelFromSourceRange(selection.range, kclManager.ast)
          )
        ),
    },
    actions: {
      'Add to code-based selection': assign({
        selectionRanges: ({ selectionRanges }, event) => ({
          ...selectionRanges,
          codeBasedSelections: [
            ...selectionRanges.codeBasedSelections,
            event.data,
          ],
        }),
      }),
      'Add to other selection': assign({
        selectionRanges: ({ selectionRanges }, event) => ({
          ...selectionRanges,
          otherSelections: [...selectionRanges.otherSelections, event.data],
        }),
      }),
      'Remove from code-based selection': assign({
        selectionRanges: ({ selectionRanges }, event) => ({
          ...selectionRanges,
          codeBasedSelections: [
            ...selectionRanges.codeBasedSelections,
            event.data,
          ],
        }),
      }),
      'Remove from other selection': assign({
        selectionRanges: ({ selectionRanges }, event) => ({
          ...selectionRanges,
          otherSelections: [...selectionRanges.otherSelections, event.data],
        }),
      }),
      'Clear selection': assign({
        selectionRanges: () => ({
          otherSelections: [],
          codeBasedSelections: [],
        }),
      }),
      'sketch mode enabled': ({ sketchPlaneId }) => {
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'sketch_mode_enable',
            plane_id: sketchPlaneId,
            ortho: true,
            animated: !isReducedMotion(),
          },
        })
      },
      'set sketchMetadata from pathToNode': assign(({ sketchPathToNode }) => {
        if (!sketchPathToNode) return {}
        return getSketchMetadataFromPathToNode(sketchPathToNode)
      }),
      'edit mode enter': ({ selectionRanges }) => {
        const pathId = isCursorInSketchCommandRange(
          engineCommandManager.artifactMap,
          selectionRanges
        )
        pathId &&
          engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: {
              type: 'edit_mode_enter',
              target: pathId,
            },
          })
      },
      'hide default planes': () => {
        kclManager.hidePlanes()
      },
      edit_mode_exit: () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: { type: 'edit_mode_exit' },
        }),
      default_camera_disable_sketch_mode: () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: { type: 'default_camera_disable_sketch_mode' },
        }),
      'reset sketch metadata': assign({
        sketchPathToNode: null,
        sketchEnginePathId: '',
        sketchPlaneId: '',
      }),
      'set sketch metadata': assign(({ selectionRanges }) => {
        const sourceRange = selectionRanges.codeBasedSelections[0].range
        const sketchPathToNode = getNodePathFromSourceRange(
          kclManager.ast,
          sourceRange
        )
        return getSketchMetadataFromPathToNode(
          sketchPathToNode,
          selectionRanges
        )
      }),
      'set tool line': assign((_, { data: tool }) => {
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'set_tool',
            tool,
          },
        })
        return { tool }
      }),
      'set tool tangential arc': () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'set_tool',
            tool: 'sketch_tangential_arc',
          },
        }),
      'equip select': () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'set_tool',
            tool: 'select',
          },
        }),
      'set tool move': () =>
        engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'set_tool',
            tool: 'move',
          },
        }),
      // TODO implement source ranges for all of these constraints
      // need to make the async like the modal constraints
      'Make selection horizontal': ({ selectionRanges }) => {
        const { modifiedAst } = applyConstraintHorzVert(
          selectionRanges,
          'horizontal',
          kclManager.ast,
          kclManager.programMemory
        )
        kclManager.updateAst(modifiedAst, true)
      },
      'Make selection vertical': ({ selectionRanges }) => {
        const { modifiedAst } = applyConstraintHorzVert(
          selectionRanges,
          'vertical',
          kclManager.ast,
          kclManager.programMemory
        )
        kclManager.updateAst(modifiedAst, true)
      },
      'Constrain horizontally align': ({ selectionRanges }) => {
        const { modifiedAst } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setVertDistance',
        })
        kclManager.updateAst(modifiedAst, true)
      },
      'Constrain vertically align': ({ selectionRanges }) => {
        const { modifiedAst } = applyConstraintHorzVertAlign({
          selectionRanges,
          constraint: 'setHorzDistance',
        })
        kclManager.updateAst(modifiedAst, true)
      },
      'Constrain snap to X': ({ selectionRanges }) => {
        const { modifiedAst } = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToXAxis',
        })
        kclManager.updateAst(modifiedAst, true)
      },
      'Constrain snap to Y': ({ selectionRanges }) => {
        const { modifiedAst } = applyConstraintAxisAlign({
          selectionRanges,
          constraint: 'snapToYAxis',
        })
        kclManager.updateAst(modifiedAst, true)
      },
      'Constrain equal length': ({ selectionRanges }) => {
        const { modifiedAst } = applyConstraintEqualLength({
          selectionRanges,
        })
        kclManager.updateAst(modifiedAst, true)
      },
      'Constrain parallel': ({ selectionRanges }) => {
        const { modifiedAst } = applyConstraintEqualAngle({
          selectionRanges,
        })
        kclManager.updateAst(modifiedAst, true)
      },
      'Constrain remove constraints': ({ selectionRanges }) => {
        const { modifiedAst } = applyRemoveConstrainingValues({
          selectionRanges,
        })
        kclManager.updateAst(modifiedAst, true)
      },
      'AST extrude': ({ selectionRanges }) => {
        const pathToNode = getNodePathFromSourceRange(
          kclManager.ast,
          selectionRanges.codeBasedSelections[0].range
        )
        const { modifiedAst, pathToExtrudeArg } = extrudeSketch(
          kclManager.ast,
          pathToNode
        )
        // TODO not handling focusPath correctly I think
        kclManager.updateAst(modifiedAst, true, {
          focusPath: pathToExtrudeArg,
        })
      },
      'set default plane id': assign({
        sketchPlaneId: (_, { data }) => data.planeId,
      }),
    },
  }
)

function getSketchMetadataFromPathToNode(
  pathToNode: PathToNode,
  selectionRanges?: Selections
) {
  const pipeExpression = getNodeFromPath<PipeExpression>(
    kclManager.ast,
    pathToNode,
    'PipeExpression'
  ).node
  if (pipeExpression.type !== 'PipeExpression') return {}
  const sketchCallExpression = pipeExpression.body.find(
    (e) => e.type === 'CallExpression' && e.callee.name === 'startSketchOn'
  ) as CallExpression
  if (!sketchCallExpression) return {}
  const firstArg = sketchCallExpression.arguments[0]
  let planeId = ''
  if (firstArg.type === 'Literal' && firstArg.value) {
    const planeStrCleaned = firstArg.value
      .toString()
      .toLowerCase()
      .replace('-', '')
    if (
      planeStrCleaned === 'xy' ||
      planeStrCleaned === 'xz' ||
      planeStrCleaned === 'yz'
    ) {
      planeId = kclManager.getPlaneId(planeStrCleaned)
    }
  }

  let sketchEnginePathId: string
  if (selectionRanges) {
    sketchEnginePathId =
      isCursorInSketchCommandRange(
        engineCommandManager.artifactMap,
        selectionRanges
      ) || ''
  } else {
    const _selectionRanges: Selections = {
      otherSelections: [],
      codeBasedSelections: [
        { range: [pipeExpression.start, pipeExpression.end], type: 'default' },
      ],
    }
    sketchEnginePathId =
      isCursorInSketchCommandRange(
        engineCommandManager.artifactMap,
        _selectionRanges
      ) || ''
  }
  console.log('returning:', {
    sketchPathToNode: pathToNode,
    sketchEnginePathId,
    sketchPlaneId: planeId,
  })
  return {
    sketchPathToNode: pathToNode,
    sketchEnginePathId,
    sketchPlaneId: planeId,
  }
}
