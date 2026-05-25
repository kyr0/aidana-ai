APP_NAME := Aidana
PROJECT := Aidana.xcodeproj
SCHEME := Aidana
CONFIG := Debug
BROWSER_EXTENSION_DIR := browser-extension
BUILD_DIR = $(shell xcodebuild -project $(PROJECT) -scheme $(SCHEME) -configuration $(CONFIG) -showBuildSettings 2>/dev/null | grep -m1 'BUILT_PRODUCTS_DIR' | awk '{print $$3}')
APP_PATH = $(BUILD_DIR)/$(APP_NAME).app
BINARY = $(APP_PATH)/Contents/MacOS/$(APP_NAME)

.PHONY: build start stop restart log clean setup test-mcp test

build:
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) -configuration $(CONFIG) build
	@echo "Built app bundle: $(APP_PATH)"

start: build stop
	@echo "Starting app bundle: $(APP_PATH)"
	@nohup $(BINARY) > /dev/null 2>&1 & \
	disown && echo "App started in background"

stop:
	@pgrep -f 'Aidana.app/Contents/MacOS/Aidana' | xargs kill -9 2>/dev/null || true
	@pgrep -f 'mlx_audio.server' | xargs kill 2>/dev/null || true

restart: stop start

log:
	@tail -f /dev/null | $(BINARY) 2>&1

clean:
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) -configuration $(CONFIG) clean

setup:
	uv sync

test-mcp:
	@echo "Running MCP test against the existing Aidana/MCP setup (server and extension assumed started)"
	cd $(BROWSER_EXTENSION_DIR) && bun run test:mcp

test: restart
	@echo "Running all MCP integration tests"
	cd $(BROWSER_EXTENSION_DIR) && bun run test:mcp
	cd mcp_tests && bun run test-web-search.ts
	cd mcp_tests && bun run test-llm-dual-mode.ts
	cd mcp_tests && bun run test-scrape-dedup.ts
