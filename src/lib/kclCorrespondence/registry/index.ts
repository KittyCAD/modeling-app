import correspondenceExtension from '@src/lib/kcl/correspondence/registry'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'

/** Correspondence is optional composition alongside KCL execution, not a requirement of a Modeling view. */
export default withProjectShellFeature(
  correspondenceExtension,
  'kcl.correspondence'
)
