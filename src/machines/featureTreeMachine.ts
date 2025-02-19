import { Artifact, getArtifactFromRange } from 'lang/std/artifactGraph'
import { SourceRange } from 'lang/wasm'
import { enterEditFlow, EnterEditFlowProps } from 'lib/operations'
import { engineCommandManager, kclManager } from 'lib/singletons'
import { err } from 'lib/trap'
import toast from 'react-hot-toast'
import { Operation } from 'wasm-lib/kcl/bindings/Operation'
import { assign, fromPromise, setup } from 'xstate'
import { commandBarActor } from './commandBarMachine'
import { getNodePathFromSourceRange } from 'lang/queryAstNodePathUtils'
import {
  deleteSelectionPromise,
  deletionErrorMessage,
} from 'lang/modifyAst/deleteSelection'

type FeatureTreeEvent =
  | {
      type: 'goToKclSource'
      data: { targetSourceRange: SourceRange }
    }
  | {
      type: 'selectOperation'
      data: { targetSourceRange: SourceRange }
    }
  | {
      type: 'deleteOperation'
      data: { targetSourceRange: SourceRange }
    }
  | {
      type: 'enterEditFlow'
      data: { targetSourceRange: SourceRange; currentOperation: Operation }
    }
  | { type: 'goToError' }
  | { type: 'codePaneOpened' }
  | { type: 'selected' }
  | { type: 'done' }
  | { type: 'xstate.error.actor.prepareEditCommand'; error: Error }
  | { type: 'xstate.error.actor.prepareDeleteCommand'; error: Error }

type FeatureTreeContext = {
  targetSourceRange?: SourceRange
  currentOperation?: Operation
}

export const featureTreeMachine = setup({
  types: {
    input: {} as FeatureTreeContext,
    context: {} as FeatureTreeContext,
    events: {} as FeatureTreeEvent,
  },
  guards: {
    codePaneIsOpen: () => false,
  },
  actors: {
    prepareEditCommand: fromPromise(
      ({
        input,
      }: {
        input: EnterEditFlowProps & {
          commandBarSend: (typeof commandBarActor)['send']
        }
      }) => {
        return new Promise((resolve, reject) => {
          const { commandBarSend, ...editFlowProps } = input
          enterEditFlow(editFlowProps)
            .then((result) => {
              if (err(result)) {
                reject(result)
                return
              }
              input.commandBarSend(result)
              resolve(result)
            })
            .catch(reject)
        })
      }
    ),
    sendDeleteCommand: fromPromise(
      ({
        input,
      }: {
        input: {
          artifact: Artifact | undefined
          targetSourceRange: SourceRange | undefined
        }
      }) => {
        return new Promise((resolve, reject) => {
          const { targetSourceRange, artifact } = input
          if (!targetSourceRange) {
            reject(new Error(deletionErrorMessage))
            return
          }

          const pathToNode = getNodePathFromSourceRange(
            kclManager.ast,
            targetSourceRange
          )
          const selection = {
            codeRef: {
              range: targetSourceRange,
              pathToNode,
            },
            artifact,
          }
          deleteSelectionPromise(selection)
            .then((result) => {
              if (err(result)) {
                reject(result)
                return
              }
              resolve(result)
            })
            .catch(reject)
        })
      }
    ),
  },
  actions: {
    saveTargetSourceRange: assign({
      targetSourceRange: ({ event }) =>
        'data' in event && !err(event.data)
          ? event.data.targetSourceRange
          : undefined,
    }),
    saveCurrentOperation: assign({
      currentOperation: ({ event }) =>
        'data' in event && 'currentOperation' in event.data
          ? event.data.currentOperation
          : undefined,
    }),
    clearContext: assign({
      targetSourceRange: undefined,
    }),
    sendSelectionEvent: () => {},
    openCodePane: () => {},
    sendEditFlowStart: () => {},
    scrollToError: () => {},
    sendDeleteSelection: () => {},
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QFkD2EwBsCWA7KAxAMICGuAxlgNoAMAuoqAA6qzYAu2qujIAHogC0ANhoBWAHQAOAMwB2KQEY5AFgCcGqWqkAaEAE9Ew0RLEqa64TIBMKmTUXCAvk71oMOfAQDKYdgAJYLDByTm5aBiQQFjYwniiBBEFFcSkJGUVFFWs5NRsxMWE1PUMENUk1ORSVYWyCpSkxFzd0LDxCXwCAW1QAVyDA9hJ2MAjeGI4ueNBE5Joi6S0zHKkamWKDRBkxOVNGvJVstWFZFWaQdzavTv9ybhG+djGoibjeWerdrTspX8UGlS6TYIWoyCTHMRZMQ0fI2aznS6eDp+fy+KBdMC4AIAeQAbmAAE6YEj6WDPZisSbcd5CTI0NSmdT0uQKawnNQqEqISE0CS2WpFcRsmwyBGtJHETEjAm3EgYgkkfzcQLBUJTcnRSlvKKlQSFazSKxqFLCOTQwFAxIyKTCRQSf5qZkOGhmtRijztCTYCCYMAEACiWMJgQA1n5yAALDWvKY0pLWSESdQyW0OKS2NQJrkIOTWBkKBRSFk2lSKBPuq5QL0+v2B6Wh8NRxSRCmxWMJITWWwSVknayKSq-YRiazZ4x2gqQxwqHbaY0VpHV30Bx4E3oYaNa9szIRibQSYTWenG-mVDalHKH9L-OTGM0phee73LgBKYFxqEw+M3bepHaShQMocijQhodjbEU2bKAU6QsvyYhwkoziuBc4pPjWPgAO5gGATA-lS0z8LuHLSJU4ggccNRFtmCYJkm5gcmW9hSDQ8IoYi6HLgAMqgABmTz0OMW5-juAGrD2uYwrYt4pI0NH9gamQ2gUxp5NaZzsWh+BLn63gRlgmD4dqol6r89o0A4xgyDYjgODRdI9kcCjTtkNSPtpz5+gAYtgmC+gJLaar+hGzGIRbSDIM4pr8SGcsCtgWAe9gqHINCrKxjoaS0HoeRhRARnKvGEkZ25EUkoh2qIDhmCx-wnHFF5WCo4LaIC5TQvMhTuVWnkriwBIBUJwVxnquZ8tYWiHmlCYWKOwIgTBLonFZkIJre3U6QQyAkGGJUiWVo1gtFZZFKsh55FBhxgsskIsmpD6aTlPUYQAIsEIwqr6arhIJLzCSFQjpmkd6HLeLI1MI2b2Os405JFsjHGaTSPZWm0ACpgI8gjsKgghEAAgi9e0AwBqg9loSjrFd2RQZFvJaJm9SFIcpYbb12K8bxQQBEwxK4KMv2tgRI22s1jTVcOZYpOIUEaAac6ZPYuQsnIooo4uvUABJtHwxMjWFaQ-KltgFOI2w0b8DIwo6VkOqobMYQACgSqBdEw7DY7jkAcHr-4iN2HLrDkE1mmyig0fYFT5CbA6HNYavZajnkSBG3pgI7fNwAQ+MDdgvEkKE-hQAqTARv4LBML0xIjBAvsmaIki1CxqipYCwdQfMzXRc5UW2rYDu+hIsARqgmEZ2QWc55w+eF8XJCl-4YBu5wkB1wde5pGaqg5FUbLG1B-bAxY5SZnvqvIYni7eGG7CRsQZCUJg1+NmviQpJF6Rsnm2wWZFUGZLsBCRQsjWRqilDaz9b4RgIG9fyYAVToilK-RAUIJCdyLDkR0XYYTZkEPHSQE09zW1NLmEOECb53zuBgReEAOD+AgL0Ak7QGxQOQQgTIeQewOFaixco9I5qlF4aYeORYGY2i7G6dWnpIGRgkDIiMABJDC20wwIIxFifw+Jc7kBIIZQWQVhb-kVkBSyeR36VHkLTdQPZ-hlkaMYVmUjtLyLkRQxRyidrwKCIgjRI8mEAC97i6LYZkLs0gcgzjNjkLIB8UrgisCxCGVE2KX2kW41xjYlHLiINwWA7AFR4H8H47AgSsS6PodgPJD8BaBRjPtN+KQDRhwWgmQEw5IbxWsgaFKKYYTqAieQxsGSoFZL9Dk3AeSCm4E0YSTgOjMAVKqRQGpQ1DGiUyMoe0VQiipVTBkeS9JwTZBDkoNKmYL6oSesM2R8jRnEFyfkkghT8YACFvD+AABohMUNZA8hRenbCYueRAE1jSwQtJHY4FlkapOcek25eUHlTP8K895ABNb5vyajS1yBBHBwJ7B0RAcOGo2R5CKEGVA657jslIqedMsgUBfTfLBaIPe6xtBlh2DRK6B5bwnBdJlHIlKbluLueMyZ9L-C+nwOwKM+i6kkyUpIMKhwzAFC7LaIEF5Jz2iLCOZkZ0sqXNRi4hFtKJmPMKUwQkNrcC0PIFXEgMpaFLMoCEpaNilA7HTP8F0DUQVmjtD8liFkzTN3AU4qsZqxWIstci4ppShh+X0P4XR2AoC4G+ZkNBLJrJLQQghS6I4bHrGhDJAcIqIzUvFXSwpWi5m6MwKm9Nmbvk5D+coDMKZIoCJQfqNBgqHDbNFlWmtcbJWFNgLgee-gcafO+baJM6YSXrAaGFWWCgDx2FvMcKmGgLkcThUM81Yy63TOnbO+dGKFX-TjJkJdeZIRWBAqlUCNE0pgmOH2JYKRjTGqPdG+FsaLWTumWAAAjr0cpMqoByu+aWHs1lDyrQNRYKCxhhDSEBOYewjoByHq0kBk9IGz3xqlUwZ1TbqC3uGkY6CfIZxrFqJmAcUFfjNVYkoB0-YqhhTHae+55HCkEiXqgfEtxz3sDJLRtZZU-1YdkD84dFgUhiCgmDJMP944QyqBkATpGCBvkEJjEIvQRghIQs1Ul-ZGa-EIdmPIkgbzCkhAhSKcgDOZIwlQ+B3sAgMKYfgFhkYWVglSgOVYvDQJ9oQEWXkZZ+wpRZLaB0XmRkTqtdMzCHAy4zoxBATRujegrL+nR9ZZZrPmG9UoPIlQobKEU6WLsM5-g7HS5GO5kZGXwJxp+NhbIZxJiKPDEbqgA05hIgoEc+bDxvopVG6lEh8aYSeQERNQSFmuqGMs-weBeKoAIBAbgYAvS4A-GGCQMAPYbbKZgQQ+3UADZAgaYwI4CgUUzBN-BWGcj8KmhNVYY6VtraKagAJm3Fk7coHt3AB2CCEhdgSCQvNhgHYJF0K7fhBC3eTQ9uHT3ZPGTKv2BC6QumFFvDN4cEd-hJjCqlayNprRSGB6tuhDbsDzKh9U2H8Pjv8zOxd0713BCc-mfjg7z2TAQWHD6vT5R5JHj5GpD7d4NAJxNVfdJIOOezK5+U7bvPHsI4JEjlH1d0eY9F+L3RkvCe1Lvf+fsS7WI1AsHueX9kt1hXkOIbIA4Fps9B6iz5fPDsC9O3gYXWOPYkAAEawEEHwe30vmraDSilU02w2QdIvBTUwYVIQcmMK0gDRGlu64CKHj54fTfm9R+wK3sfBAJ6Tynx70vG4jlzPh4+NQLYlpS2aW01p5CEauS4qvKK3n+DRXXyPQvUCXdF23wQ+hU9E9KokF3zUdju5+cmfsMgoa-3BMoM2tpjBKGD3Q0P8+TeI-BxbtH4PrfY7XxvzvW-6kgscAQ0lFdcRX4E-AlaWZdFLEcVYDQSRWFYjKlafRlX0BfE7JfFfD-fAX0TfR3crEnf-UwAcDPU0OcbVEFZMdINpVTb4coW-AIJA+BR-M3Z-RvZvVfTAsAbA1ZYnHfRwLDU+CxMwT9OSeKKKUwDIbPCaUsMwYHJgXmVNWDOVSTYTLEI7VA6PZfU7fGbwNGQQO4ZQwQBQ+VHAuTHgqwTteOE+UsdQdTeKQ8O0QELII8MtayTMGQuQ6VTEODMuPQsDdgevZgy3N-ZbbQ3Q89Awzw+DH-EmXfa8TMGEA2UsYFBANaK2FiPcGaDkGEWg8uW1TEB1J1F1SpaHBggnVQwXdQ9Aj2G1AkO1fI4kAkQQI3ZZTgsrEwv-HNZQKoVKWac6UAi8GScmcoIoKwDId7bI6o2ornAonnXbRghvQIjHFvCYvIqY+oxooo6pFooWbg9o4NFkC-Ho7+GiPTQYwCEYl7GFLXNJIZLiPAXrVAT8AgbrfAe4-rKIuMIOSqNKXMU4c+OQDTa0AgklFKHYZDTXQDJbW4-mOdB4zACQBRXADgbOCAQrKpAacuVAPAQaVonYhAC0AhL+WwHTRnf+D+O8LsFMOXfYMdKE14uEhEpE0gZZPRYw3EhMWoCg-1GbCRdDeaCwXYL7LIUsUEXDGku4mEz8CQXAN-XRYgTAVgLxNxNhQENKcaaWGcDkaEYQ0oH5HNFKQ4PsekU2cvSfdJWkiUuEnyRE4ecuF2XiXyP0RfCo07bmXoJgXQnAKUQQNgDAb0txb0sAHxaTOQZUpWaQQsHdXg-sA+MFIsZyeYZQAcfjRbFxc0vrS0vASpMuJgO0h0-w5HFgoI10908gT0rEb0tOP0xsAMoM2AEM94-8UGNIRwRoQ4IY0JWJBkcWD3FuI8LIlM9JBkvwthR0MEJuZ9GoHYcGf+KoHsBMRobeJaNKMdIcggKgZsLg7fRAPILDDZU0ctUBJQA+DtYBeYLsRLS4iElxNGHrLEbAcpZ1cgGEp4gqF4i05U2SFXBGLQflRXPk5XNkb1SwYvW0MdG8l4u8h8gkJ8nGeExEvw8ZTgXAErRePgIo5hHMviB05U4BL8zo1iPpPolBNlTtViZiRoGwVnAcoZcCmASChZR8mEqUmUzAOUhUkLIwzc3-PE3eQdPIKoZTdQJI5QG0caffDINSAcFJK449KlWiqUe8hi6Cpiq0rM20rC5cJ087DQoePwN0j07AL0n0jg2Af07xdRaTYQZUo8O0bBMwW8DUxwDDfcHtW0CESmLqaiuS28zgKCmC1ACQVSm0zC+05cJ-AshYzHYsgyoyys0y6s8yqUWAKyhs0SVrQ2f5BQY0Q8eODTcQdIBxIsECLIf-MdXoe1VAQYZ1dgeRbEXAMoqPbSy7LQnQ8q47b0oYAaWqrNVK+TdMMERwEvYCaJSEDuOnSoYqpLeQDBMdN8UIegi0l8nrd83qq0U0BLVVTuMwBadjFkenDIcwMbfsuApbOanbJlOk5bdnJCqAFUPQwrO4AkfmAkAgIKsuUTea9g5U7QeWDkWQN7QHcOMA+QRYDIVKSaTVCfU1dJM6ha9Mq6tbZhcHDNPAZEwrD6865A5GqAPAb69MaQSrIcIkzIC2bIdIF0MGlKVSKik6lxWG9gi0wKzM4eSAfwemi6hqtAl0vSksssj2YyqsqBGsiymTVkrcvEiaO0b4yKcoVkerAleYK2BwzU40YhWakITGy6kgFE5hCABUfifwDG+gzm503Sj2fSvWkgfiQQI2r61axAdQaxMiyOVYfsGJBWmoT+RwH5RiQOTzLy2Rdm5A+G7W2hYLS2g222jm8Kl-JvIs7HC2-Wj2KO5le2vE+wO0aKUsNKMweQWLPMF0PlPMR0BCUc46mS+A2RIgKUYMIOukpat89MgbIqvkF0ZQaa8QBQPPFBRiPVXMH5SEQEZM2m9JauoMGUOuxmqvZhR656165m7wmumUFO0rbY8W6EewUwTlQ4eYINeSWQbDR2uxekaFMdMe+sSe+G6e4LbG1G-GFE24Jew2jWha2+nqsW7i6ELIQ0fBdKAjb7M5e0HYPcOwAoBys+p+y+2Epm60-SQrc+2ul+9gk2pq7m9gfS0swy8sgW+KoWxKrEWAaway2c-9Lug9GcGwi8ZDLhWaWOBMEBiB8etmpBi6xm0O+hJOx+phlelBmPbmQQROq2j2Sgcem2lh1Oj+kmL+6zRnZiYgyxeKf4NIF0PMccCLFkRhi+8RrWh+iOgIER+sHhmOwsxY-hwR62gxwkMRz6i66yzhbYA9Q8hueyTZQoJuZTCyLPMdUssAMgQIauP0EJL+cJHeqmH2jQDuaxVyBSJQGSGmiupbcZTnYLedfLVm3EYrR0tQ1BiQEgPJCVLLAAOTlEgAADVMnnt45P41I4jpZSCEBRjG4shd4Rwchboz7uBknbrUmSnCsMnMASt8zY7m88n2ACmplimCtymBnV6DE2SfkBreFHaAagbSgRRN4shxARxMxVBlBsifCstn6egJMDmplpNeGdL2rTn6UxHjmODrmsTKnXtEs4J5AGINMl1-htghKQJjB5wA7q1p8Hnplccm19ALnLsrmwjQWU1ntrEasLB+rekJsmJmzzybRUpVIrB9nz0ZltEwWIXTsoX9DbdYW07SdAE6Q-qMh0xYsFnJB0o5Y1oqdwSK8p9rqlCwMwcIc7tm000cBM1CWJBiWwMcdkak0wXW8BX36uLojNmkNIyyLbQFBLohsUwIlUhbAy0cXlC8XG0U1+WM16qtKY8RWssxd9d5lm0pWjWnm+V7B6RshUgWQoJBDyYsgf0Nlh6En2XQdgXAgZ0mAYTPkhWzWplvTA3PZk84W0hWz6g8g2RMxN0JxzAapTRv4JodWuXL0g3r1Q3cZgWI354o39BnszADxHRtkKTqsP0rxVBrYPsVJrIs3DnINoMFlDD83Qj9C227dDC4WEtQHjhjQFAbAUXhwDRCgixRiqasgW3kVKMFQ-IsAu3C3F3qMWTZW4wKX7R2TMEt4sx5oixmo5cmQ2yoQTToahl8plq0ZYS9suY1y07rRchDRagBxppSUD5oR6JrRRBRiWyz7XyYB-A73PwH3YA1yNycTxaX2uyHEP30wv35pmJf2bQYRiqTggPb37285IOqBrBJGPiix4P33HQkPahaZjA0P-3MP4mrzR7gP4EwOFk8O1yZAiP-w4O33EjP3KP5pXIaOMPn16O2XGOcPwO2OqAVBOPRJuObQyO+OUW24hOAOsOAWJAb23yWOIO1yxBZOyp5OEPyP+QUW3Wrp0O1OgcNOtOQOdOpPhADOrQSOePEPTPXX9wLPaORPL3tdr3sBoLg7YSG6QOm7yWQC+Q-0bQpLsV2M4lREbY+xR9-aR7-PAvLrr7bq360bbgAufGlQmEcaZWYPP6LIsNPdrDcx32oYN4VdooThzQh6z68ugvJTMu2btbsB+h57YHcv0u2Fy0DQ87QUdhQQiKGnXb0hGg9wCNYnahmv0vGa3rWaiAWusnyicnorMHYrfTcHIxhakqVBiGBSbA90LJlB5a1nZBJBVYN5ch6HVAoa-OqVVvFuQ6dbw7OHyA1uhWzH3S9HdC1uBv5gjpGIOpQY7AoZwauFMXj3jYQIFv8v3uw7bq9G+ufGhmTGoqE7-uk7Af+u07wI98qWPd0wi0CU9x8wdz-UKbxBsPtPoHYBeYOAbqOLy5sAbVfvmf+b-SmAOeOC85BB+ZIBV406HReRQSWNxBmQbAxwJoxLpqnDoCUufXxOGfJSmecB2BWe9vsz+fMfIqh5ufBb9u+ebUHteIhecIMBa4xfIoVV2oEx1gQIUxsw9xdgFoPd5yfaFtUuXumPQPGeea2f0dFqTWdKtu+aKzduzLAyRa15Sh+k9hQUnNCgfa9Ad8+NTAc626FAcNWXTTr2A+WOza3SQ-wdFrjHDfI+sH+a4rY-ayE+HbMxk+GZtg0-1gM-A0QJs-xYuios7BEfg6IxRN4EWAsTFrnjQvYTlSPdwQwZKeTlu68TBO2UrBZpS7LyxO0ukeR+cIMSJ+r7rrmF7SCQ8kD+VD77CtT-z-x+sRvr8qwpok8wzR+lKGHaIkuEwEHEOQh-es9+x+mJDREf0RrBYgg91C-n4Sv53VuAhWO-tiTXrcULQWGa0GbG9T0grA2YcCAaDSK1A-sFMWAqrx37D9R+kAthh91R5fc1uc6AAZAN+449GiePb7ul2xgADBA8A76hkFIg-ljkO6CbCzF5Avp1W8gKoOXQY7ED-+pA+AVPWP4pNU4BIOAUAL8JvV0eJA-fhwMJ4F4qoHUNxhyiwGFAVU+6ayNpj-40CpBSgpbgvVZrMDd+5grEvQPQa81a+0fEyg3xFpiBju26TuA4SFCrMHaU7NBIeHkAQQ6YW-QvlAn8DSl-AM8XSKqACxgB84VcHmJnDYTJBygheUfJRAnbu1Gov2bPJOBHBlhz4G0MgNgC6DDBmE86VHPzCFalDyhIwKNjEOVKiVVaI7MCEmXG57wew2eFphkE7glDES9QyoZVWqF+gq+r+RYnUOGAcEcYggJoWLzoiDZiwMIdMByFvBQxKgSUOOJFmf5PdPQUw1nvOkxjoUwBbiWoYMOmFRtdezQvgn+jCgpBfmwxMcFeAsDkQjwtENIgMLKEVCUmlVY4XkmYS68DeEwzHAcJmG4xrh5LRKOdwwFUk+42YaAvRFcjGA0BI4DaPjFkLNpmEmMfJOuHW6NUY8OItcBgHxh5J3As-VuqmCsBWBcUCjfot-WkjFUbAlkaQotgxFyFsRq4PEcCLjqLEiReI0kewHJGE9eQR4KkT2lpH-F4oeaNBJCFkD2YWRvnT0OyKxE31OY3McuJnCFZ8QuYfgcePzEFHCinOWwCoMpj-Y1B8My-AcKlFMD8ouUdgbIHsO0gqj9ASNdUSiFGE8jm8Oo7mPqLACGj0AbCFMHsHUAgRvi9IGKB+hSAFU-cw4OEKCXRGYjXRwWfSDgD4BCtUx2APgAGNt7GiEAP7BNgmDay2B7Mfg5IkWBQGaoPcOVYIYmI5EpidYXooIpmOzFkjAxadAsfGOLEWhoy8UJzLu17xiiKSqsOsaqNuqwBsIuEX7pOKYA5jlSKqC0esD7iQh7Ay-btPaGSzDgqgFoX-myKTGAiZxTY0xjOLnGE9fsSjWyD3kaT1MnehscQlYQcCuQC+qMF0cwnlL8QhW749gKeLzF7g+Qh4VYCyAKBxjOhF+NBG1EHBpRMgBQUccmNupfijxmOL8T+K3b-hhw4IayP0n1Tko2Q8kb+m7h2BJZTkw4WCYCNTGsVw+l2Fmn5BQklcpGimS2EKT-Q50pRF4eYM2VeHBwvmbIUiWAPImISh45E2iYgJJhLpqRESQsKrAUguNJ2vSFdI4QQgq8ISr44LKFX8hCs1JfgYSXM3XoClMos4XeMlDLEiJOM5aKSG7RTBKSK8Kk26ppL8LjDeRmOOydpMVRxgwoB4IIZFFLCOEqcPKTet-AdBcofavE26t1i6BFQXqlE07GFIikuSnccnNIO5VqDZ0WMuVWwjmi-i5BTkB6aSspP3HBYYphIASYVIJBxTcCVoBkDSPrbiwjUBQGiCSki5Hg5YCEHeCFP8DOxXY7sKNv5l+69B48XQDgOwJdjLwTMtCBATpO4rbA0E4hcQraE37mx4oE0LDHn1WG2Rwaz4xcDZPanDSupswnqQ5ObywA+pA0qojtI9j+YgxN3eIlBOHSWS1xcIcEE4TsCSEFOVkq5FtNgR+AvEcQqYKG3ehgBfAX0OIGVLaLsJN4E0bYG80VqqAbQNEA9PaChQrAe8uYNqZ9I+hBAgZv0g6UEQ8BfTAZGtKYCDNxIDgkwFkBKJOXJRFDT8P7E4FVyNCtZjgLgFCNKQwDwAoggGVCSZArEeTxsYMR7sv0EAPTpszkRSQ3FykV5PInMg6FuLQQ1N0wFkEuvUy0C8gRZmeboi6FE5XJk4qcDAH6LZkiSRYhyekC4Xlkn0N080DhOGXOQ2hMwlMQgRCWTjDxR4esqWbMBzyDFMiY+QVMJVYgEJ0BL-DWSjIBauzEAqsBkOUBf5hiUw6qV1q3zAi94HWmsq9lSlPQhz2ERYoEmO1bgjhjApJCXnuGMF3hm2GnafDCxmIw5HsacxMlhmHA-VSwNgLohHHl63g6YfuUFNZz96yJp8pLcuSUQOxVzVYvIaao0CWBBCVWijUSnHEkIdQRK2RGvOHgHmIYM6lQFKPLKzwWxTQ4ZHccfAa5KjZKXcjlvfgXl0T709bRyLmDgi2APWrErYOd23SUkQeJsJ0ZXUBYcsFqlck+UYlUBggosMUAEOsJEJDYr55QEsFyhdBuE+WhhTlllnYADzASOVbyRYQyB-x4ooJSLgrLbrMRIo4xXIvalWLOpe5x8g2V-PyrVRIZSHY0McTpw-Jcgdhb4PHDFLQl0yacuoF2QjLkpS8ZYz4PaHTYZhDq2zRhZdSHIsLvJSYb9HmHobJR3+7CH2l4OHHZ4YQb05ObIjTLQNpSGOXRGnOhBhJ5yxoSiqrBSi0wOiDjCJC9mtBhDlF1aVRZKRUEhUHSLC8lGIoa6-NSwVQKxGiwBr3hd6K5eCmnILDghtmfGGECSmkUPoDQx8Aumul3RKLnusieSvRTTTKUcYLCl3uNH9wOUZuVo9QM2TFlNw3ckaTudWniW+UlK-lOChwAcXf16g2g93pgPmhF4PJQoA1LdA0YadililRJWUvUXlDMALCrQdinWqshx5OpFLFsLiKM598Sc2JUUp8odLGKsFWxbmV9AOKHAASyKLTKQ7WQNMJaDQOdyDgBypl1xKlG1UqpokaqbiOqmnIUjp5C0F+MCHUp1JhoEZSgbIEDB+TizwhgdbRhaRYXxwwQ0tSrqsJvnJFaZ9oMfAUG2AxRfeRAqlFAza6yDxxIQWAZJieqEgWFIxcaFfh+A+oJsB1QQY0j+zfptA6tGxq1zhLtc366K+YPTj+z8JoYN48GElGgJvZBqjgElZrUsGwNWaddFhQzj1QU1zAuzLlFDHPJOKtqg8wEOyrhrQNQ6utThivV5UsRuhZFB0UKWkUp95+mRTDCCQ2lHKq6kDb5cws-lpUKS5+VeUUEoh1T5ocRWIsWA8x7xn5iTA1aSoy4IqUVz1FhdD3MAmhVY94OkSCkvB6oNA2c1ph3JhX6qmGcK8lW6spXGqyoawewnCBSgPDoC6qp5bVhVgqM+ye8l+Zp2dUcr4ay3eBvmvoK8qSIksbhOhxnDAr8E9hP1BQycxFhNGiDF1eQMKxo9LGy9bRmWpPagQgYPaEcPZA-hg0Toh5fuBpx8Z+NYAATKuV2DSAGDxwGdQocCr4QIz+UDQRGF2A6bnZ9cvwyIb0yKwzMB5pCgcNDCDTqBhlWwX5hJCPAqR7uBS8Na-L9a4tRMdzaBWc31kTSlURQRSJh1YyFAjSGmKJg8PdycoYQuq-eU+roT+sYWzaKuT+vtB-rSctoY8igLaRd1VApsD5ZYoRrQbcWpLODXGrfgIboJg1ZDVwswl8gbApoLICxGHAWB52UqWDS2mlbwaW+0Eo8ICB7StZLovyMKPwQLqH4c1leDlv6wI0sajWbG39Qai41NRCgrrPMIOnu4NwKFEG3NUC1xY5tg2HyY9ZIG4RKQR1UkWWH+LBiKLUBc2GJXqqg36NNNgbYNmil01oJA8XzRMkZviidwew2i27pht+aMbCkvbDthEQjBSbENMm-6vby4UYqB+vuIIafD83TJ12y7XpURpQSM4YxkWWJvYnqZ1QcBvqQCiVSYj087OuHLmGnPJQMgFIhE34FUC+yOZy2X2f9BnhLrYbplmnagUauIUmrFNCbM7sOku5bBQYeqBMJUBsr2JTBIAyYDfUK54B0V6QzqFZkBQpBgVkMk9kh3cz8bMg426Bu1xfCdd+gnqz2oWA1lbM5RUPA+kh1VhlgjSuYNTYk3a3QMi1-gV7j43RXlsMBaUAENUChi-AbutEMsLsoU6OqXEz2slbkwoEcMhGqgsAOiqmm4ZA4KYTImWOjkMsEdLOQeUBKK3MdYS8Gzeb7NyA4qlAE0KGDYDQSrDBUQlb1ZjsD4a9ueOvNxOzxtQDye+eO2WlFjsRYCNA8-SOH2WyoGkqdJfYsuXxlAdav127WzL33LQiV8+HOydkDA1zATgpNndrbQOkEi7XJjZCRF4OSmnJChWAtKAxJZxHAVhnlQpW1re4q6LBE21njfx5hKDFVzUWjeqjqjjgsBoqsfM3EG48Sld5uuwcAO21urwByK+AbytvBOa3GCbJyFgIkrghoUpwLQPIHG0W7D+Mq8HR2uV2+7YFKWvEiOAd1ngIxDojQNIrjixsDJuQOwJygsWtaQdkg9QZbv92gDum8gxQViXRXdhi6yU6CNymBAzhqO+oQlBElED2zt+L3dPbXuT02KrBD1UfYAJb1Z6Zw3YSLJs1YiDV+BtQXYG3FibGyTYVaSIZVRiFpy8EJaN7ICG3hOELoBKThMpGZGFCYC5YRbAcOGGaiJ4ac8KEELsJ2ATgwg+qZIGTANaIQj3L4UML3X-C6djYPxVTwobX5KKwpMcKJWwRMRBVisNqfyIwAH67AdoJCMy2ppmBvsqsedfeHeG50pCbUn0R6MzhoHy2wDdZfQ3hHWqFgbUN3HloegnUtpLYtA-2CTAiVjg4iZQIcA3kEJ2ynKCau1j3H1jxxM49g9Zlrl4HHurZNcV-SORQSQG3qR1VtK-FoHEonKPuLUFWjmLvcDLfih1BHZ5o2p1E5LZ1oOjmB08Ze2hXOsaSdCXQFQVLFqlITgw2pdkjQ-8qW31zxCqsCOOxuOjjZzkt2raSVLQMfxoQ5oF3nHE6GpYxFCnCwGvxa3Kj8pt1DqSNL2ljS0D1iPcEXJ0O4ozA+9bpA3LHaKTDgqM-6Z9AJn7R1dJkdA+Tn5nNZ-25PNZsvrnIbJl9LMSNC4CAA */
  id: 'featureTree',
  description: 'Workflows for interacting with the feature tree pane',
  context: ({ input }) => input,
  states: {
    idle: {
      on: {
        goToKclSource: {
          target: 'goingToKclSource',
          actions: 'saveTargetSourceRange',
        },

        selectOperation: {
          target: 'selecting',
          actions: 'saveTargetSourceRange',
        },

        enterEditFlow: {
          target: 'enteringEditFlow',
          actions: ['saveTargetSourceRange', 'saveCurrentOperation'],
        },

        deleteOperation: {
          target: 'deletingOperation',
          actions: ['saveTargetSourceRange'],
        },

        goToError: 'goingToError',
      },
    },

    goingToKclSource: {
      states: {
        selecting: {
          on: {
            selected: {
              target: 'done',
            },
          },

          entry: ['sendSelectionEvent'],
        },

        done: {
          entry: ['clearContext'],
          always: '#featureTree.idle',
        },

        openingCodePane: {
          on: {
            codePaneOpened: 'selecting',
          },

          entry: 'openCodePane',
        },
      },

      initial: 'openingCodePane',
    },

    selecting: {
      states: {
        selecting: {
          on: {
            selected: 'done',
          },

          entry: 'sendSelectionEvent',
        },

        done: {
          always: '#featureTree.idle',
          entry: 'clearContext',
        },
      },

      initial: 'selecting',
    },

    enteringEditFlow: {
      states: {
        selecting: {
          on: {
            selected: {
              target: 'prepareEditCommand',
              reenter: true,
            },
          },
        },

        done: {
          always: '#featureTree.idle',
        },

        prepareEditCommand: {
          invoke: {
            src: 'prepareEditCommand',
            input: ({ context }) => {
              const artifact = context.targetSourceRange
                ? getArtifactFromRange(
                    context.targetSourceRange,
                    engineCommandManager.artifactGraph
                  ) ?? undefined
                : undefined
              return {
                // currentOperation is guaranteed to be defined here
                operation: context.currentOperation!,
                artifact,
                commandBarSend: commandBarActor.send,
              }
            },
            onDone: {
              target: 'done',
              reenter: true,
            },
            onError: {
              target: 'done',
              reenter: true,
              actions: ({ event }) => {
                if ('error' in event && err(event.error)) {
                  toast.error(event.error.message)
                }
              },
            },
          },
        },
      },

      initial: 'selecting',
      entry: 'sendSelectionEvent',
      exit: ['clearContext'],
    },

    deletingOperation: {
      states: {
        selecting: {
          on: {
            selected: {
              target: 'deletingSelection',
              reenter: true,
            },
          },
        },

        done: {
          always: '#featureTree.idle',
        },

        deletingSelection: {
          invoke: {
            src: 'sendDeleteCommand',
            input: ({ context }) => {
              const artifact = context.targetSourceRange
                ? getArtifactFromRange(
                    context.targetSourceRange,
                    engineCommandManager.artifactGraph
                  ) ?? undefined
                : undefined
              return {
                artifact,
                targetSourceRange: context.targetSourceRange,
              }
            },
            onDone: {
              target: 'done',
              reenter: true,
            },
            onError: {
              target: 'done',
              reenter: true,
              actions: ({ event }) => {
                if ('error' in event && err(event.error)) {
                  toast.error(event.error.message)
                }
              },
            },
          },
        },
      },

      initial: 'selecting',
      entry: 'sendSelectionEvent',
      exit: ['clearContext'],
    },

    goingToError: {
      states: {
        openingCodePane: {
          entry: 'openCodePane',

          on: {
            codePaneOpened: 'done',
          },
        },

        done: {
          entry: 'scrollToError',

          always: '#featureTree.idle',
        },
      },

      initial: 'openingCodePane',
    },
  },

  initial: 'idle',
})
