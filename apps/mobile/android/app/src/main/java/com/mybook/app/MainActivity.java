package com.mybook.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // 必须在 BridgeActivity.onCreate 之前注册，bridge 创建时才看得到插件。
        registerPlugin(MobileSyncDiscoveryPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
