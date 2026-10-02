package ph.hmr.pos

import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.webkit.WebView
import com.getcapacitor.BridgeActivity
import ph.hmr.pos.printer.EscPosPrinterPlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Custom plugins must be registered before the bridge is created.
        registerPlugin(EscPosPrinterPlugin::class.java)
        super.onCreate(savedInstanceState)
        // Remote WebView debugging only for debuggable (debug) builds — never in release.
        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        WebView.setWebContentsDebuggingEnabled(debuggable)
    }
}
