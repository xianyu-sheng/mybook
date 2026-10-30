package com.mybook.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiManager;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 局域网里寻找电脑端 Mybook。
 *
 * 主路径：向组播地址和每张网卡的广播地址发送 discover，电脑端 UDP 47822 回复 announce。
 * 兜底：有些 Wi-Fi 会吞掉广播/组播，但允许普通 HTTP；这时扫描本机 /24（必要时 /23）
 * 的 47821 端口，用 /health 确认是不是 Mybook。
 *
 * 回复和扫描结果只包含名称、端口、设备指纹，配对码不会出现在发现阶段。
 */
@CapacitorPlugin(name = "MobileSyncDiscovery")
public class MobileSyncDiscoveryPlugin extends Plugin {

    private static final int DISCOVERY_PORT = 47822;
    private static final int SYNC_PORT = 47821;
    private static final String MULTICAST_GROUP = "224.0.0.167";
    private static final int SCAN_DURATION_MS = 2200;
    private static final int HTTP_SCAN_TIMEOUT_MS = 350;
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

        DatagramSocket socket = openDatagramSocket();
        socket.setBroadcast(true);
        socket.setSoTimeout(RECEIVE_TIMEOUT_MS);

        try {
            byte[] request = new JSONObject()
                .put("app", "mybook")
                .put("type", "discover")
                .put("version", 1)
                .toString()
                .getBytes(StandardCharsets.UTF_8);
            Map<String, JSObject> found = new LinkedHashMap<>();
            sendDiscovery(socket, request, discoveryTargets(), found, SCAN_DURATION_MS);

            // 广播/组播被 Wi-Fi 丢弃时，退回普通 HTTP 扫描；这也能兼容只允许
            // 单播、不允许局域网广播的路由器。
            if (found.isEmpty()) {
                for (JSObject device : scanHttpFallback()) {
                    String key = device.optString("address") + ":" + device.optInt("port", SYNC_PORT);
                    found.putIfAbsent(key, device);
                }
            }

            return new ArrayList<>(found.values());
        } finally {
            socket.close();
            if (lock != null && lock.isHeld()) lock.release();
        }
    }

    /** 把 UDP socket 绑定到 Wi-Fi/以太网，避免广播被系统默认路由到蜂窝网络。 */
    private DatagramSocket openDatagramSocket() throws Exception {
        DatagramSocket socket = new DatagramSocket();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return socket;
        try {
            ConnectivityManager manager = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            if (manager == null) return socket;
            for (Network network : manager.getAllNetworks()) {
                NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
                if (capabilities == null) continue;
                if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                    || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) {
                    network.bindSocket(socket);
                    break;
                }
            }
        } catch (Exception ignored) {
            // 绑定失败时保留系统默认网络，继续尝试。
        }
        return socket;
    }

    private void sendDiscovery(DatagramSocket socket, byte[] request, Set<InetAddress> targets, Map<String, JSObject> found, int durationMs) throws Exception {
        long deadline = System.currentTimeMillis() + durationMs;
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
            receiveAnnouncement(socket, found);
        }
    }

    private void receiveAnnouncement(DatagramSocket socket, Map<String, JSObject> found) {
        byte[] buffer = new byte[2048];
        DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
        try {
            socket.receive(packet);
        } catch (SocketTimeoutException ignored) {
            return;
        } catch (Exception ignored) {
            return;
        }

        try {
            String text = new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8);
            JSONObject info = new JSONObject(text);
            if (!"mybook".equals(info.optString("app")) || !"announce".equals(info.optString("type"))) return;

            String address = packet.getAddress().getHostAddress();
            if (address.startsWith("::ffff:")) address = address.substring(7);
            int port = info.optInt("port", SYNC_PORT);
            String key = address + ":" + port;
            if (found.containsKey(key)) return;
            found.put(key, deviceFromAnnouncement(info, address, port));
        } catch (Exception ignored) {
            // 忽略非 Mybook 或损坏的 UDP 包。
        }
    }

    private JSObject deviceFromAnnouncement(JSONObject info, String address, int port) {
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
        return device;
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

    /**
     * 扫描本机所在 /24（网段前缀更小时用 /23），向每个地址请求 /health。
     * 只用于 UDP 广播完全收不到回复的情况。
     */
    private List<JSObject> scanHttpFallback() {
        Set<String> candidates = localSubnetCandidates();
        if (candidates.isEmpty()) return new ArrayList<>();

        ExecutorService pool = Executors.newFixedThreadPool(48);
        List<Future<JSObject>> futures = new ArrayList<>();
        try {
            for (String candidate : candidates) {
                futures.add(pool.submit(() -> probeHealth(candidate)));
            }
            List<JSObject> found = new ArrayList<>();
            for (Future<JSObject> future : futures) {
                try {
                    JSObject device = future.get(HTTP_SCAN_TIMEOUT_MS + 900L, TimeUnit.MILLISECONDS);
                    if (device != null) found.add(device);
                } catch (Exception ignored) {
                    // 未响应或超时的地址直接跳过。
                }
            }
            return found;
        } finally {
            pool.shutdownNow();
        }
    }

    private JSObject probeHealth(String address) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL("http://" + address + ":" + SYNC_PORT + "/health");
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(HTTP_SCAN_TIMEOUT_MS);
            connection.setReadTimeout(HTTP_SCAN_TIMEOUT_MS);
            connection.setRequestMethod("GET");
            connection.setUseCaches(false);
            if (connection.getResponseCode() != 200) return null;

            StringBuilder body = new StringBuilder();
            try (InputStream input = connection.getInputStream();
                 BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
                char[] chunk = new char[512];
                int total = 0;
                int count;
                while ((count = reader.read(chunk)) > 0 && total < 4096) {
                    body.append(chunk, 0, count);
                    total += count;
                }
            }
            JSONObject info = new JSONObject(body.toString());
            if (!"mybook".equals(info.optString("app"))) return null;

            int port = info.optInt("port", SYNC_PORT);
            JSObject device = new JSObject();
            device.put("name", info.optString("name", "Mybook 电脑"));
            device.put("address", address);
            device.put("port", port);
            device.put("endpoint", "http://" + address + ":" + port);
            device.put("fingerprint", info.optString("fingerprint", ""));
            JSArray endpoints = new JSArray();
            endpoints.put("http://" + address + ":" + port);
            device.put("endpoints", endpoints);
            return device;
        } catch (Exception ignored) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private Set<String> localSubnetCandidates() {
        Set<String> result = new LinkedHashSet<>();
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces != null && interfaces.hasMoreElements()) {
                NetworkInterface network = interfaces.nextElement();
                if (!network.isUp() || network.isLoopback()) continue;
                for (InterfaceAddress interfaceAddress : network.getInterfaceAddresses()) {
                    if (!(interfaceAddress.getAddress() instanceof Inet4Address)) continue;
                    byte[] bytes = interfaceAddress.getAddress().getAddress();
                    int own = ((bytes[0] & 0xff) << 24) | ((bytes[1] & 0xff) << 16) | ((bytes[2] & 0xff) << 8) | (bytes[3] & 0xff);
                    int prefix = interfaceAddress.getNetworkPrefixLength();
                    // 只扫本机所在 /24，避免在 /17 这类大网段里扫几万个地址。
                    int scanPrefix = 24;
                    int mask = 0xffffff00;
                    int base = own & mask;
                    int count = 1 << (32 - scanPrefix);
                    for (int host = 1; host < count - 1; host += 1) {
                        int value = base + host;
                        if (value == own) continue;
                        String candidate = ((value >>> 24) & 0xff) + "." + ((value >>> 16) & 0xff) + "."
                            + ((value >>> 8) & 0xff) + "." + (value & 0xff);
                        result.add(candidate);
                    }
                }
            }
        } catch (Exception ignored) {
            // 忽略没有权限/不可用的网卡。
        }
        return result;
    }
}
