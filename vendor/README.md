# Pagination SDK preview

`kittycad-lib-e8bcbcb.tgz` is a temporary npm package built from
[KittyCAD/kittycad.ts#747](https://github.com/KittyCAD/kittycad.ts/pull/747),
commit `e8bcbcb61888e964430fbe3730492827a381a240`. It lets this draft use
the SDK's collection compatibility before an npm release exists.

SHA-256: `8f433a42060ca44749595d90187f72e478cf6889fedcb36db048e84f2fe86f21`.

Build the same commit with `npm ci`, `npm run gen`, and `npm run build`, then
run `npm pack` to inspect or replace the package. The SDK does not commit its
`dist` files or build them during installation, so a git dependency alone would
not provide usable exports.

Before merging this draft, replace the `file:vendor/kittycad-lib-e8bcbcb.tgz`
dependency with the released SDK version, regenerate the lockfile, and remove
this directory.
