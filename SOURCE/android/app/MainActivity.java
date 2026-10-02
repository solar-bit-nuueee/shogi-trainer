package com.speaki.shogi;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Android WebView has no site isolation, so SharedArrayBuffer (and the
        // threaded WASM engine) can never work here — COOP/COEP headers don't
        // help. Instead we run the engine as a native process via this plugin.
        registerPlugin(ShogiEnginePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
