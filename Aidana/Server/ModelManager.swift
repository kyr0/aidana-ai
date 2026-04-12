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
    private var ctcModels: CtcModels?
    private var asrRuntimeConfiguration = ASRRuntimeConfiguration()
    private var lastAppliedASRRuntimeConfiguration: ASRRuntimeConfiguration?

    private(set) var asrReady = false
    private(set) var asrWarmedUp = false

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

    func setASRRuntimeConfiguration(_ configuration: ASRRuntimeConfiguration) async throws -> Bool {
        guard configuration != asrRuntimeConfiguration || lastAppliedASRRuntimeConfiguration != configuration else {
            return false
        }

        asrRuntimeConfiguration = configuration

        if asrReady {
            try await applyASRRuntimeConfiguration(configuration)
            lastAppliedASRRuntimeConfiguration = configuration
        }

        logger.info(
            "Stored ASR runtime configuration with \(configuration.effectiveHotwords.count, privacy: .public) boosted terms"
        )
        return true
    }

    func transcribe(samples: [Float]) async throws -> ASRResult {
        guard let manager = asrManager else {
            throw ModelError.notReady("ASR models not loaded")
        }
        return try await manager.transcribe(samples, source: .microphone)
    }

    func warmupASR() async throws -> TimeInterval {
        guard let manager = asrManager else {
            throw ModelError.notReady("ASR models not loaded")
        }

        guard !asrWarmedUp else { return 0 }

        let sampleRate = 16_000
        let durationSeconds = 2.0
        let sampleCount = Int(Double(sampleRate) * durationSeconds)
        var samples = [Float]()
        samples.reserveCapacity(sampleCount)

        for index in 0..<sampleCount {
            let time = Double(index) / Double(sampleRate)
            samples.append(Float(sin(2 * Double.pi * 220 * time) * 0.05))
        }

        let startedAt = Date()
        _ = try await manager.transcribe(samples, source: .microphone)
        let elapsed = Date().timeIntervalSince(startedAt)
        asrWarmedUp = true
        logger.info("ASR warmup completed in \(elapsed, privacy: .public)s")
        return elapsed
    }

    // MARK: - Lifecycle

    func shutdown() {
        asrManager = nil
        asrModels = nil
        ctcModels = nil
        asrRuntimeConfiguration = ASRRuntimeConfiguration()
        lastAppliedASRRuntimeConfiguration = nil
        asrReady = false
        asrWarmedUp = false
        logger.info("ModelManager shut down")
    }

    private func applyASRRuntimeConfiguration(_ configuration: ASRRuntimeConfiguration) async throws {
        guard let manager = asrManager else { return }

        guard configuration.hotwordBoostingEnabled else {
            manager.disableVocabularyBoosting()
            logger.info("ASR vocabulary boosting disabled")
            return
        }

        let ctcModels = try await loadCTCModelsIfNeeded()
        let vocabulary = CustomVocabularyContext(
            terms: configuration.effectiveHotwords.map { CustomVocabularyTerm(text: $0) }
        )

        try await manager.configureVocabularyBoosting(vocabulary: vocabulary, ctcModels: ctcModels)
        logger.info(
            "ASR vocabulary boosting enabled for \(configuration.effectiveHotwords.count, privacy: .public) terms"
        )
    }

    private func loadCTCModelsIfNeeded() async throws -> CtcModels {
        if let ctcModels {
            return ctcModels
        }

        logger.info("Preparing Parakeet CTC models for vocabulary boosting…")
        let loadedModels = try await CtcModels.downloadAndLoad()
        ctcModels = loadedModels
        logger.info("Parakeet CTC models ready")
        return loadedModels
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
