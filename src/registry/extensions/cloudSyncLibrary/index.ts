// The `cloud` project-library type handler is always-on infrastructure, kept
// separate from the toggle-able cloud-sync plugin so that disabling cloud sync
// never removes the ability to browse or create projects in the Personal Cloud
// folder (on web that folder is the canonical project storage). See
// cloudSyncProjectLibraryType in @src/lib/cloudSync/registry/plugin.
export { cloudSyncProjectLibraryType as default } from '@src/lib/cloudSync/registry/plugin'
