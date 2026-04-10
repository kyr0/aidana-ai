APP_NAME := Aidana
PROJECT := Aidana.xcodeproj
SCHEME := Aidana
CONFIG := Debug
BUILD_DIR = $(shell xcodebuild -project $(PROJECT) -scheme $(SCHEME) -configuration $(CONFIG) -showBuildSettings 2>/dev/null | grep -m1 'BUILT_PRODUCTS_DIR' | awk '{print $$3}')
APP_PATH = $(BUILD_DIR)/$(APP_NAME).app
BINARY = $(APP_PATH)/Contents/MacOS/$(APP_NAME)

.PHONY: build start stop restart log clean setup

build:
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) -configuration $(CONFIG) build

start: build stop
	$(BINARY) &

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
