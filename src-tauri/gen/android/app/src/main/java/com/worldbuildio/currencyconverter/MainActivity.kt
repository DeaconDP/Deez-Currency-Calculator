package com.worldbuildio.currencyconverter

import android.graphics.Color
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // The UI is always dark, so ask for light status/nav bar icons regardless
    // of the system light/dark setting (auto made them dark-on-dark).
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)
  }

  // The pixel font only renders crisply at whole multiples of 8px, so keep the
  // WebView at 100% text zoom and tell the page the system font scale instead;
  // it switches on the app's Large Text mode (8px labels → 16px).
  override fun onWebViewCreate(webView: WebView) {
    val scale = resources.configuration.fontScale
    webView.settings.textZoom = 100
    webView.settings.userAgentString = "${webView.settings.userAgentString} DeacsFontScale/$scale"
  }
}
