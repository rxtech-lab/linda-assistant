//
//  AppColors.swift
//  ios
//
//  Created by Qiwei Li on 2/8/26.
//
import SwiftUI

extension Color {
    static let primaryButtonColor = Color.orange

    /// Soft purple accent color for QuestionSheetView icons
    static let questionSheetIconColor = Color(red: 0.55, green: 0.4, blue: 0.75)
}

// MARK: - Gradient Themes

extension LinearGradient {
    /// Soft purple gradient background for QuestionSheetView
    static let questionSheetBackgroundColor = LinearGradient(
        colors: [
            Color(red: 0.96, green: 0.94, blue: 1.0),
            Color(red: 0.92, green: 0.88, blue: 0.98),
            Color(red: 0.88, green: 0.82, blue: 0.96),
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
}
