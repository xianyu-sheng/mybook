package com.mybook.app;

import android.content.Context;
import android.net.wifi.WifiManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 局域网里寻找电脑端 Mybook。
 *
 * 不依赖第三方库：向组播地址和每张网卡的广播地址发送一个 discover 包，
 * 电脑端的 UDP 47822 服务收到后单播回复 announce。回复里只有名称、端口和
 * 设备指纹，不包含配对码。
 */
@CapacitorPlugin(name = "MobileSyncDiscovery")
public class MobileSyncDiscoveryPlugin extends Plugin {

    private static final int DISCOVERY_PORT = 47822;
    private static final String MULTICAST_GROUP = "224.0.0.167";
    private static final int SCAN_DURATION_MS = 2600;
    private static final int SEND_INTERVAL_MS = 650;
    private static final int RECEIVE_TIMEOUT_MS = 250;

    @PluginMethod
    public void discover(PluginCall call) {
        new Thread(() -> {
            try {
                List<JSObject> devices = scan();
                JSArray array = new JSArray();
                for (JSObject device : devices) array.put(device);
                JSObject result = new JSObject();
                result.put("devices", array);
                getBridge().executeOnMainThread(() -> call.resolve(result));
            } catch (Exception error) {
                String message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
                getBridge().executeOnMainThread(() -> call.reject("局域网扫描失败：" + message, "DISCOVERY_FAILED", error));
            }
        }, "mybook-discovery").start();
    }

    private List<JSObject> scan() throws Exception {
        WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        WifiManager.MulticastLock lock = wifi == null ? null : wifi.createMulticastLock("mybook-discovery");
        if (lock != null) {
            lock.setReferenceCounted(false);
            lock.acquire();
        }

        DatagramSocket socket = new DatagramSocket();
        socket.setBroadcast(true);
        socket.setSoTimeout(RECEIVE_TIMEOUT_MS);

        try {
            byte[] request = new JSONObject()
                .put("app", "mybook")
                .put("type", "discover")
                .put("version", 1)
                .toString()
                .getBytes(StandardCharsets.UTF_8);
            Set<InetAddress> targets = discoveryTargets();
            Map<String, JSObject> found = new LinkedHashMap<>();
            long deadline = System.currentTimeMillis() + SCAN_DURATION_MS;
            long nextSendAt = 0;

            while (System.currentTimeMillis() < deadline) {
                long now = System.currentTimeMillis();
                if (now >= nextSendAt) {
                    for (InetAddress target : targets) {
                        try {
                            socket.send(new DatagramPacket(request, request.length, target, DISCOVERY_PORT));
                        } catch (Exception ignored) {
                            // 某些接口不允许广播/组播，换下一个目标。
                        }
                    }
                    nextSendAt = now + SEND_INTERVAL_MS;
                }

                byte[] buffer = new byte[2048];
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                try {
                    socket.receive(packet);
                } catch (SocketTimeoutException ignored) {
                    continue;
                }

                String text = new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8);
                JSONObject info;
                try {
                    info = new JSONObject(text);
                } catch (Exception ignored) {
                    continue;
                }
                if (!"mybook".equals(info.optString("app")) || !"announce".equals(info.optString("type"))) continue;

                String address = packet.getAddress().getHostAddress();
                if (address.startsWith("::ffff:")) address = address.substring(7);
                int port = info.optInt("port", 47821);
                String key = address + ":" + port;
                if (found.containsKey(key)) continue;

                JSObject device = new JSObject();
                device.put("name", info.optString("name", "Mybook 电脑"));
                device.put("address", address);
                device.put("port", port);
                device.put("endpoint", "http://" + address + ":" + port);
                device.put("fingerprint", info.optString("fingerprint", ""));

                // 电脑可能有多张网卡（Wi-Fi / USB 共享 / WSL），把候选地址一起交给
                // JS 端做健康检查，选一个手机真正连得上的。
                JSArray endpoints = new JSArray();
                Set<String> seenEndpoints = new LinkedHashSet<>();
                addEndpoint(endpoints, seenEndpoints, "http://" + address + ":" + port);
                JSONArray addresses = info.optJSONArray("addresses");
                if (addresses != null) {
                    for (int index = 0; index < addresses.length(); index += 1) {
                        String candidate = addresses.optString(index, "");
                        if (candidate != null && candidate.matches("\\d{1,3}(\\.\\d{1,3}){3}")) {
                            addEndpoint(endpoints, seenEndpoints, "http://" + candidate + ":" + port);
                        }
                    }
                }
                device.put("endpoints", endpoints);
                found.put(key, device);
            }

            return new ArrayList<>(found.values());
        } finally {
            socket.close();
            if (lock != null && lock.isHeld()) lock.release();
        }
    }

    private void addEndpoint(JSArray endpoints, Set<String> seen, String endpoint) {
        if (seen.add(endpoint)) endpoints.put(endpoint);
    }

    private Set<InetAddress> discoveryTargets() throws Exception {
        Set<InetAddress> targets = new LinkedHashSet<>();
        targets.add(InetAddress.getByName(MULTICAST_GROUP));
        targets.add(InetAddress.getByName("255.255.255.255"));

        Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
        while (interfaces != null && interfaces.hasMoreElements()) {
            NetworkInterface network = interfaces.nextElement();
            if (!network.isUp() || network.isLoopback()) continue;
            for (InterfaceAddress address : network.getInterfaceAddresses()) {
                if (address.getAddress() instanceof Inet4Address && address.getBroadcast() != null) {
                    targets.add(address.getBroadcast());
                }
            }
        }
        return targets;
    }
}
