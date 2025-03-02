.PHONY: dev

KCL_WASM_LIB_FILES := $(wildcard rust/**/*.rs)
TS_SRC := $(wildcard src/**/*.tsx) $(wildcard src/**/*.ts)
XSTATE_TYPEGENS := $(wildcard src/machines/*.typegen.ts)

dev: node_modules public/wasm_lib_bg.wasm $(XSTATE_TYPEGENS)
	yarn start

# I'm sorry this is so specific to my setup you may as well ignore this.
# This is so you don't have to deal with electron windows popping up constantly.
# It should work for you other Linux users.
lee-electron-test:
	Xephyr -br -ac -noreset -screen 1200x500 :2 &
	DISPLAY=:2 NODE_ENV=development PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:4444/ yarn tron:test -g "when using the file tree"
	killall Xephyr

$(XSTATE_TYPEGENS): $(TS_SRC)
	yarn xstate typegen 'src/**/*.ts?(x)'

public/kcl_wasm_lib_bg.wasm: $(KCL_WASM_LIB_FILES)
	yarn build:wasm

node_modules: package.json yarn.lock
	yarn install
