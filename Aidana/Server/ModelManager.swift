//
//  ModelManager.swift
//  Aidana
//

import FluidAudio
import Foundation
import os

actor ModelManager {
    private let logger = Logger(subsystem: "de.aronhomberg.aidana", category: "ModelManager")

    private(set) var asrManager: AsrManager?
    private(set) var asrModels: AsrModels?

    private(set) var asrReady = false

    /// Default cache directory used by FluidAudio for Parakeet TDT v3 models.
    static var modelCacheDirectory: URL {
        AsrModels.defaultCacheDirectory(for: .v3)
    }

    /// Whether the required model files are already present on disk.
    static func modelsAreCached() -> Bool {
        AsrModels.modelsExist(at: modelCacheDirectory, version: .v3)
    }

    // MARK: - ASR

    func prepareASR() async throws {
        guard !asrReady else { return }
        logger.info("Preparing Parakeet TDT v3 ASR models…")
        let models = try await AsrModels.downloadAndLoad(version: .v3)
        let manager = AsrManager(config: .default)
        try await manager.initialize(models: models)
        asrManager = manager
        asrModels = models
        asrReady = true
        logger.info("Parakeet TDT v3 ASR models ready")
    }

    func transcribe(samples: [Float]) async throws -> ASRResult {
        guard let manager = asrManager else {
            throw ModelError.notReady("ASR models not loaded")
        }
        return try await manager.transcribe(samples, source: .microphone)
    }

    // MARK: - Lifecycle

    func shutdown() {
        asrManager = nil
        asrModels = nil
        asrReady = false
        logger.info("ModelManager shut down")
    }

    enum ModelError: LocalizedError {
        case notReady(String)

        var errorDescription: String? {
            switch self {
            case .notReady(let msg): return msg
            }
        }
    }
}
