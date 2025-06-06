# Zoo Design Studio
### Developer manual

.PHONY: **all**

**all**: **install**

## Installation

.PHONY: **install**

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

**install**: node_modules/.package-lock.json $ $(CARGO) $ $(WASM_PACK)

- node_modules/.package-lock.json: package.json package-lock.json
	- npm prune
	- npm install

- $(CARGO):
	- npm run install:rust

- $(WASM_PACK):
	- npm run install:wasm-pack:sh

-:
$\:
