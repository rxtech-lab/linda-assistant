//
//  LindaWidgetBundle.swift
//  LindaWidget
//
//  Created by Qiwei Li on 4/25/26.
//

import WidgetKit
import SwiftUI

@main
struct LindaWidgetBundle: WidgetBundle {
    var body: some Widget {
        LindaWidget()
        LindaWidgetControl()
        LindaWidgetLiveActivity()
    }
}
