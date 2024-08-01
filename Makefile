.PHONY: dev

WASM_LIB_FILES := $(wildcard src/wasm-lib/**/*.rs)
TS_SRC := $(wildcard src/**/*.tsx) $(wildcard src/**/*.ts)
XSTATE_TYPEGENS := $(wildcard src/machines/*.typegen.ts)

dev: node_modules public/wasm_lib_bg.wasm $(XSTATE_TYPEGENS)
	yarn start

$(XSTATE_TYPEGENS): $(TS_SRC)
	yarn xstate typegen 'src/**/*.ts?(x)'

public/wasm_lib_bg.wasm: $(WASM_LIB_FILES)
	yarn build:wasm-dev

node_modules: package.json yarn.lock
	yarn install
