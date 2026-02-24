import AssistantCore
import Foundation
import RichText
import SafariServices
import SwiftUI
import WebKit

struct EmailContentView: View {
    let email: Email
    @State private var selectedAttachment: EmailAttachment?
    @State private var selectedImageURL: URL?
    @State private var webViewError: Error?

    private var formattedDate: String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: email.receivedAt) {
            let displayFormatter = DateFormatter()
            displayFormatter.dateFormat = "M/dd/yy"
            return displayFormatter.string(from: date)
        }
        // Fallback: try without fractional seconds
        formatter.formatOptions = [.withInternetDateTime]
        if let date = formatter.date(from: email.receivedAt) {
            let displayFormatter = DateFormatter()
            displayFormatter.dateFormat = "M/dd/yy"
            return displayFormatter.string(from: date)
        }
        return email.receivedAt
    }

    private var senderInitial: String {
        if let name = email.fromName, let first = name.first {
            return String(first).uppercased()
        }
        return String(email.fromEmail.prefix(1)).uppercased()
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // Header Card
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .top, spacing: 12) {
                        // Sender Avatar
                        ZStack {
                            RoundedRectangle(cornerRadius: 8)
                                .fill(Color.blue.opacity(0.15))
                                .frame(width: 44, height: 44)
                            Text(senderInitial)
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundStyle(.blue)
                        }

                        // Sender Info
                        VStack(alignment: .leading, spacing: 4) {
                            Text(email.fromName ?? email.fromEmail.components(separatedBy: "@").first ?? "Unknown")
                                .font(.headline)
                                .foregroundStyle(.primary)

                            HStack(spacing: 4) {
                                Text("To:")
                                    .foregroundStyle(.secondary)
                                Text(email.toEmail.components(separatedBy: "@").first ?? email.toEmail)
                                    .foregroundStyle(.primary)
                            }
                            .font(.subheadline)

                            HStack(spacing: 4) {
                                Text("Reply to:")
                                    .foregroundStyle(.secondary)
                                Text(email.fromEmail)
                                    .foregroundStyle(.blue)
                            }
                            .font(.subheadline)
                        }

                        Spacer()

                        // Date
                        Text(formattedDate)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding()

                Divider()

                // Body
                if let htmlBody = email.htmlBody {
                    RichText(html: htmlBody)
                        .lineHeight(160)
                        .colorScheme(.auto)
                        .fontType(.system)
                        .linkOpenType(.Safari)
                        .customCSS("""
                        img {
                            max-width: 100%;
                            height: auto;
                            object-fit: fit;
                            loading: lazy;                  /* Native lazy loading */
                        }
                        """)
                        .onMediaClick { media in
                            switch media {
                            case .image(let src):
                                if let url = URL(string: src) {
                                    selectedImageURL = url
                                }
                            case .video:
                                break
                            }
                        }
                        .placeholder {
                            ProgressView()
                                .frame(maxWidth: .infinity, minHeight: 100)
                        }
                        .padding(.horizontal)
                        .padding(.vertical, 16)
                } else {
                    Text("No content")
                        .foregroundStyle(.secondary)
                        .padding()
                }

                // Attachments
                if let attachments = email.attachments, !attachments.isEmpty {
                    Divider()
                        .padding(.horizontal)

                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Image(systemName: "paperclip")
                                .foregroundStyle(.secondary)
                            Text("Attachments")
                                .font(.headline)
                        }

                        LazyVGrid(
                            columns: [
                                GridItem(.flexible()),
                                GridItem(.flexible()),
                            ], spacing: 10
                        ) {
                            ForEach(attachments) { attachment in
                                Button {
                                    selectedAttachment = attachment
                                } label: {
                                    AttachmentCardView(attachment: attachment)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .padding()
                }
            }
        }
        .sheet(item: $selectedAttachment) { attachment in
            NavigationStack {
                if let url = URL(string: attachment.url) {
                    Group {
                        if let error = webViewError {
                            VStack(spacing: 16) {
                                Image(systemName: "exclamationmark.triangle")
                                    .font(.system(size: 48))
                                    .foregroundStyle(.secondary)
                                Text("Failed to load attachment")
                                    .font(.headline)
                                Text(error.localizedDescription)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .multilineTextAlignment(.center)
                                    .padding(.horizontal)
                                Button("Try Again") {
                                    webViewError = nil
                                }
                                .buttonStyle(.bordered)
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                        } else {
                            WebView(url: url, loadError: $webViewError)
                        }
                    }
                    .navigationTitle(attachment.name)
                    .navigationBarTitleDisplayModeInlineIfAvailable()
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") {
                                selectedAttachment = nil
                                webViewError = nil
                            }
                        }
                    }
                }
            }
        }
        #if os(iOS)
        .fullScreenCover(isPresented: Binding(
            get: { selectedImageURL != nil },
            set: { if !$0 { selectedImageURL = nil } }
        )) {
            if let url = selectedImageURL {
                NavigationStack {
                    ImageViewerView(imageURL: url)
                        .navigationBarTitleDisplayModeInlineIfAvailable()
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button {
                                    selectedImageURL = nil
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .font(.title2)
                                        .symbolRenderingMode(.palette)
                                        .foregroundStyle(.white, .black.opacity(0.6))
                                }
                            }
                        }
                        .toolbarBackground(.hidden, for: .navigationBar)
                }
            }
        }
        #else
        .sheet(isPresented: Binding(
                    get: { selectedImageURL != nil },
                    set: { if !$0 { selectedImageURL = nil } }
                )) {
                    if let url = selectedImageURL {
                        NavigationStack {
                            ImageViewerView(imageURL: url)
                                .toolbar {
                                    ToolbarItem(placement: .cancellationAction) {
                                        Button("Done") {
                                            selectedImageURL = nil
                                        }
                                    }
                                }
                        }
                        .frame(minWidth: 600, minHeight: 500)
                    }
                }
        #endif
    }
}

private extension View {
    @ViewBuilder
    func navigationBarTitleDisplayModeInlineIfAvailable() -> some View {
        #if os(iOS)
            navigationBarTitleDisplayMode(.inline)
        #else
            self
        #endif
    }
}

#if DEBUG
    private enum EmailContentViewPreviewData {
        /// Short email - just a few lines
        static let shortEmail: Email = {
            let json = """
            {
              "id": "email_short",
              "userId": "user_123",
              "assigneeId": "assignee_456",
              "fromEmail": "bob@example.com",
              "fromName": "Bob",
              "toEmail": "support@linda.ai",
              "subject": "Quick question",
              "htmlBody": "<p>Hi, just checking in. Thanks!</p>",
              "receivedAt": "2026-02-12T09:14:00Z",
              "isRead": true,
              "attachments": [
                {"type": "pdf", "url": "https://example.com/doc.pdf", "name": "document.pdf"}
              ]
            }
            """
            return try! JSONDecoder().decode(Email.self, from: Data(json.utf8))
        }()

        /// Medium email - a paragraph or two
        static let mediumEmail: Email = {
            let json = """
            {
              "id": "email_medium",
              "userId": "user_123",
              "assigneeId": "assignee_456",
              "fromEmail": "alice@example.com",
              "fromName": "Alice",
              "toEmail": "support@linda.ai",
              "subject": "Project update",
              "htmlBody": "<p>Hi team,</p><p>Just wanted to give you a quick update on the project. We've made good progress this week and are on track to meet our deadline.</p><p>Let me know if you have any questions.</p><p>Best,<br/>Alice</p>",
              "receivedAt": "2026-02-12T10:30:00Z",
              "isRead": false,
              "attachments": [
                {"type": "pdf", "url": "https://example.com/report.pdf", "name": "report.pdf"}
              ]
            }
            """
            return try! JSONDecoder().decode(Email.self, from: Data(json.utf8))
        }()

        /// Long email - multiple sections
        static let longEmail: Email = {
            let json = """
            {
              "id": "email_long",
              "userId": "user_123",
              "assigneeId": "assignee_456",
              "fromEmail": "karen@acme.co",
              "fromName": "Karen O.",
              "toEmail": "support@linda.ai",
              "subject": "Follow-up on onboarding checklist",
              "htmlBody": "<html><body><p>Hi team,</p><p>Here is a longer update with more context and detail for the preview. I broke the items down by section so you can skim them quickly and verify the layout when the content gets long.</p><p><strong>Summary</strong></p><ul><li>Steps 1-3 are done.</li><li>Notes are in the shared doc.</li><li>Waiting on access approval for step 4.</li></ul><p><strong>Details</strong></p><p>Step 1: I completed the account setup and verified the profile info. Step 2: I added the required integrations and confirmed data is flowing. Step 3: I reviewed the checklist and left comments where there are open questions.</p><p>Step 4 is pending because the approval ticket is still in review. I will follow up tomorrow morning if it has not been approved.</p><p>Step 5 is dependent on the approval, but I already prepared the configuration so it should be quick once access is granted.</p><p><strong>Additional context</strong></p><p>We should also consider documenting the onboarding steps in the shared wiki and adding a short internal checklist to avoid last-minute confusion. I can draft that if helpful.</p><p>Thanks!<br/>Karen</p></body></html>",
              "receivedAt": "2026-02-12T09:14:00Z",
              "isRead": true,
              "attachments": [
                {"type": "pdf", "url": "https://example.com/checklist.pdf", "name": "onboarding-checklist.pdf"},
                {"type": "image", "url": "https://example.com/screenshot.png", "name": "screenshot.png"},
                {"type": "audio", "url": "https://example.com/note.m4a", "name": "voice-note.m4a"}
              ]
            }
            """
            return try! JSONDecoder().decode(Email.self, from: Data(json.utf8))
        }()

        /// Very long email - extensive content
        static let veryLongEmail: Email = {
            let json = """
            {
              "id": "email_very_long",
              "userId": "user_123",
              "assigneeId": "assignee_456",
              "fromEmail": "legal@company.com",
              "fromName": "Legal Team",
              "toEmail": "support@linda.ai",
              "subject": "Quarterly Review Document",
              "htmlBody": "<h2>Quarterly Business Review</h2><p>Dear Team,</p><p>Please find below the comprehensive quarterly review for Q4 2025. This document contains important updates across all departments.</p><h3>Executive Summary</h3><p>This quarter has been exceptionally productive with significant achievements across all business units. Revenue grew by 15% compared to the previous quarter, and we successfully launched three new products.</p><h3>Sales Performance</h3><p>The sales team exceeded their targets by 20%. Key wins include the enterprise contract with Acme Corp and expansion into the European market. The pipeline for next quarter looks strong with several large deals in negotiation.</p><h3>Product Development</h3><p>Engineering completed the v2.0 release ahead of schedule. Major features include improved performance, new API endpoints, and enhanced security measures. User feedback has been overwhelmingly positive.</h3><h3>Marketing Initiatives</h3><p>Brand awareness increased by 30% through targeted campaigns. Social media engagement doubled, and the content marketing strategy drove a 40% increase in organic traffic.</p><h3>Operations</h3><p>Infrastructure costs were reduced by 25% through optimization efforts. System uptime remained at 99.9%, and customer support response times improved by 15%.</p><h3>Next Steps</h3><ul><li>Finalize Q1 2026 planning</li><li>Complete annual performance reviews</li><li>Launch new partner program</li><li>Expand customer success team</li></ul><p>Please review this document and come prepared to discuss at our all-hands meeting next week.</p><p>Best regards,<br/>The Leadership Team</p>",
              "receivedAt": "2026-02-12T08:00:00Z",
              "isRead": false,
              "attachments": [
                {"type": "pdf", "url": "https://example.com/q4-review.pdf", "name": "Q4-Review-2025.pdf"},
                {"type": "pdf", "url": "https://example.com/financials.pdf", "name": "financials.pdf"},
                {"type": "image", "url": "https://example.com/chart.png", "name": "revenue-chart.png"}
              ]
            }
            """
            return try! JSONDecoder().decode(Email.self, from: Data(json.utf8))
        }()
    }

    #Preview("Short Email") {
        EmailContentView(email: EmailContentViewPreviewData.shortEmail)
    }

    #Preview("Medium Email") {
        EmailContentView(email: EmailContentViewPreviewData.mediumEmail)
    }

    #Preview("Long Email") {
        EmailContentView(email: EmailContentViewPreviewData.longEmail)
    }

    #Preview("Very Long Email") {
        EmailContentView(email: EmailContentViewPreviewData.veryLongEmail)
    }
#endif
