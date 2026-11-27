# Project libraries

A library is a named place to store projects. Both `directory` and `cloud` use
the same [registry contract](../../registry/contracts/projectLibraries.ts).
`projectLibraryTypesFacet` maps each type to its provider's operations and Home
presentation.

## Who owns each type

- **`directory`** is built into the [project libraries extension](registry/index.ts).
  Desktop users add, edit, and reorder folders in **Settings → Local Libraries**.
  The extension reads those folders through `readRealizations` and provides local
  project operations through the file-operations service.
- **`cloud`** comes from the [cloud projects extension](../cloudProjects/registry/library.ts).
  It contributes Personal Cloud and the libraries discovered from the API, along
  with cloud project entries and operations. Its refresh operation reloads the
  cloud library catalog and projects.

## How Home assembles the list

[`projectLibrariesFromSettings`](index.ts) combines configured libraries with
provider-contributed libraries by ID. A configured entry takes precedence for a
matching ID. Pickers use library IDs for selection and titles for display.

The [Home overview](../../routes/Home.tsx) renders **Local Libraries** first in
settings order, followed by the sections contributed through `homeSection`. A new
provider can contribute its own discovered libraries, section title, and project
operations through the registry. Provider-specific discovery and
management belong in that provider's extension.

**Refresh** next to Search reloads the visible libraries on the overview or the
selected library on its detail page.

**Legacy browser default.** The cloud extension still defaults browser settings
to Personal Cloud. This keeps fresh browser profiles from falling back to a
directory library and lets the [legacy `/file/…` loader](../routeLoaders.ts)
resolve the project root for nested cloud files. The settings entry and the
registry contribution share `cloud-personal`, so Home shows one library.
