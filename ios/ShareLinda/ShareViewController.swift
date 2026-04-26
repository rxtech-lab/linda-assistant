import os
import SwiftUI

#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

private let logger = Logger(subsystem: "ShareLinda", category: "ShareViewController")

#if os(iOS)
final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        logger.info("ShareLinda viewDidLoad")

        guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
              let providers = item.attachments, !providers.isEmpty
        else {
            logger.warning("No attachments; completing empty")
            finish()
            return
        }
        logger.info("Received \(providers.count) provider(s)")

        Task { @MainActor in
            let loaded = await ShareItemLoader.load(providers)
            logger.info("Loaded \(loaded.count) item(s)")
            let root = ShareRootView(
                loaded: loaded,
                onComplete: { [weak self] url in self?.openHostAndFinish(url: url) },
                onCancel: { [weak self] in self?.cancel() }
            )
            embed(root)
        }
    }

    private func embed<V: View>(_ view: V) {
        let host = UIHostingController(rootView: view)
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        self.view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: self.view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: self.view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: self.view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: self.view.bottomAnchor),
        ])
        host.didMove(toParent: self)
    }

    private func openHostAndFinish(url: URL) {
        logger.info("openHostAndFinish with url=\(url.absoluteString)")

        var responder: UIResponder? = self
        while responder != nil {
            if let application = responder as? UIApplication {
                application.open(url, options: [:]) { [weak self] success in
                    logger.info("UIApplication.open returned success=\(success)")
                    self?.extensionContext?.completeRequest(returningItems: nil)
                }
                return
            }
            responder = responder?.next
        }

        logger.error("Could not find UIApplication in responder chain")
        extensionContext?.completeRequest(returningItems: nil)
    }

    private func cancel() {
        extensionContext?.cancelRequest(withError: NSError(
            domain: "ShareLinda",
            code: NSUserCancelledError,
            userInfo: nil
        ))
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: nil)
    }
}
#elseif os(macOS)
final class ShareViewController: NSViewController {
    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 400, height: 300))
    }
    override func viewDidLoad() {
        super.viewDidLoad()
        logger.info("ShareLinda viewDidLoad (macOS)")

        guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
              let providers = item.attachments, !providers.isEmpty
        else {
            logger.warning("No attachments; completing empty")
            finish()
            return
        }
        logger.info("Received \(providers.count) provider(s)")

        Task { @MainActor in
            let loaded = await ShareItemLoader.load(providers)
            logger.info("Loaded \(loaded.count) item(s)")
            let root = ShareRootView(
                loaded: loaded,
                onComplete: { [weak self] url in self?.openHostAndFinish(url: url) },
                onCancel: { [weak self] in self?.cancel() }
            )
            embed(root)
        }
    }

    private func embed<V: View>(_ view: V) {
        let host = NSHostingController(rootView: view)
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        self.view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: self.view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: self.view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: self.view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: self.view.bottomAnchor),
        ])
    }

    private func openHostAndFinish(url: URL) {
        logger.info("openHostAndFinish with url=\(url.absoluteString)")
        NSWorkspace.shared.open(url)
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }

    private func cancel() {
        extensionContext?.cancelRequest(withError: NSError(
            domain: "ShareLinda",
            code: NSUserCancelledError,
            userInfo: nil
        ))
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }
}
#endif

