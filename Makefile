# Zoo Design Studio
### Developer manual

Welcome to Zoo Design Studio GitHub repository! Below are various recipes you can type into `make`. To build everything, type `make all`. [](:)

#

.PHONY: **all**

**all**: **install**

## Installation

.PHONY: **install**

You will need NodeJS. From there the build system will install Rust as well, followed by hundreds of millions of dependencies /s [](:)

```sh :
ifeq ($(OS),Windows_NT)
  export WINDOWS := true
  ifndef MSYSTEM
    export POWERSHELL := true
  endif
endif
#\
```

```sh :
ifdef WINDOWS
  CARGO ?= $(USERPROFILE)/.cargo/bin/cargo.exe
  WASM_PACK ?= $(USERPROFILE)/.cargo/bin/wasm-pack.exe
else
  CARGO ?= $(shell which cargo || echo ~/.cargo/bin/cargo)
  WASM_PACK ?= $(shell which wasm-pack || echo ~/.cargo/bin/wasm-pack)
endif
#\
```

### Installing dependencies

**install**: node_modules/.package-lock.json [$]() $(CARGO) [$]() $(WASM_PACK)

- node_modules/.package-lock.json: package.json package-lock.json
	- `npm prune`
	- `npm install`

- $(CARGO):
	- `npm run install:rust`

- $(WASM_PACK):
	- `npm run install:wasm-pack:sh`

-:
$\:
):
