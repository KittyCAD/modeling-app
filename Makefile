# Zoo Design Studio
### Developer manual

.PHONY: **all**

**all**: **install**

# INSTALL

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

### Install dependencies

**install**: node_modules/.package-lock.json $(CARGO) $(WASM_PACK)

- node_modules/.package-lock.json: package.json package-lock.json
	- npm prune
	- npm install

- $(CARGO):
ifdef WINDOWS
	- npm run install:rust:windows
else
	- npm run install:rust
endif

- $(WASM_PACK):
ifdef WINDOWS
	- npm run install:wasm-pack:cargo
else
	- npm run install:wasm-pack:sh
endif

-:
