//
//  AidanaApp.swift
//  Aidana
//

import SwiftUI

@main
struct AidanaApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        Settings {
            EmptyView()
        }
    }
}
