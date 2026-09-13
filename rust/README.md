# Rust Crates

### Releasing

1. Make sure your working directory is this directory.
1. Bump the versions of the crates:
    ```bash
    just bump-kcl-crate-versions 
    ```
3. Commit the changes:
    ```bash
    git checkout -b "release/VERSION_GOES_HERE"
    git add .
    git commit -m "Bump versions"
    ```
4. Push the changes, get your PR approved, and merge it to main.
5. Check out main, to the commit from your merged PR.
6. Publish the crates:
    ```bash
    just publish-kcl {version}
    ```
    - This will publish the relevant crates and push a new tag with the prefix
    `kcl-`. DO NOT SET THE PREFIX TO `kcl-` when you run the command. The `just`
    command will do that for you.
    - The tag will then trigger the release of `kcl-python-bindings` and
        `kcl-language-server`.
