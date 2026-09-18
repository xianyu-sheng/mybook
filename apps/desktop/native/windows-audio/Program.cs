using System.Diagnostics;
using System.Text;
using System.Text.Json;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace Mybook.WindowsAudio;

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false,
    };

    private static async Task<int> Main(string[] args)
    {
        try
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            if (args.Length == 1 && string.Equals(args[0], "list", StringComparison.OrdinalIgnoreCase))
            {
                WriteJson(new { devices = DeviceCatalog.List() });
                return 0;
            }

            if (args.Length == 3 && string.Equals(args[0], "capture", StringComparison.OrdinalIgnoreCase)
                && string.Equals(args[1], "--inputs", StringComparison.OrdinalIgnoreCase))
            {
                var inputs = JsonSerializer.Deserialize<CaptureInput[]>(args[2], JsonOptions)
                    ?? throw new ArgumentException("--inputs 必须是 JSON 数组");
                await CaptureSession.RunAsync(inputs);
                return 0;
            }

            Console.Error.WriteLine("用法：mybook-windows-audio list | capture --inputs '[{\"source\":\"设备ID\",\"kind\":\"microphone|system\",\"file\":\"绝对.wav\"}]'");
            return 2;
        }
        catch (JsonException error)
        {
            Console.Error.WriteLine($"Windows 音频助手参数 JSON 无效：{error.Message}");
            return 2;
        }
        catch (ArgumentException error)
        {
            Console.Error.WriteLine($"Windows 音频助手参数无效：{error.Message}");
            return 2;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"Windows 音频助手失败：{error.Message}");
            return 1;
        }
    }

    private static void WriteJson<T>(T value) => Console.WriteLine(JsonSerializer.Serialize(value, JsonOptions));
}

internal sealed class CaptureInput
{
    public string Source { get; set; } = "";
    public string Kind { get; set; } = "";
    public string File { get; set; } = "";
}

internal sealed record AudioDeviceDto(string Name, string Label, bool Monitor, bool IsDefault, bool Muted);

internal static class DeviceCatalog
{
    public static IReadOnlyList<AudioDeviceDto> List()
    {
        using var enumerator = new MMDeviceEnumerator();
        using var defaultCapture = TryDefault(enumerator, DataFlow.Capture);
        using var defaultRender = TryDefault(enumerator, DataFlow.Render);
        var devices = new List<AudioDeviceDto>();

        foreach (var device in enumerator.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active))
        {
            using (device)
            {
                devices.Add(new AudioDeviceDto(device.ID, device.FriendlyName, false,
                    defaultCapture?.ID == device.ID, ReadMuted(device)));
            }
        }
        foreach (var device in enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
        {
            using (device)
            {
                devices.Add(new AudioDeviceDto(device.ID, $"系统声音 · {device.FriendlyName}", true,
                    defaultRender?.ID == device.ID, ReadMuted(device)));
            }
        }
        return devices;
    }

    public static MMDevice Resolve(MMDeviceEnumerator enumerator, string source, bool monitor)
    {
        if (string.IsNullOrWhiteSpace(source)) throw new ArgumentException("录音设备 ID 不能为空");
        var flow = monitor ? DataFlow.Render : DataFlow.Capture;
        if (string.Equals(source, "default", StringComparison.OrdinalIgnoreCase))
            return enumerator.GetDefaultAudioEndpoint(flow, Role.Console);
        var device = enumerator.GetDevice(source);
        try
        {
            if (device.DataFlow != flow || device.State != DeviceState.Active)
                throw new InvalidOperationException($"找不到活动音频设备：{source}");
            return device;
        }
        catch
        {
            device.Dispose();
            throw;
        }
    }

    private static MMDevice? TryDefault(MMDeviceEnumerator enumerator, DataFlow flow)
    {
        try { return enumerator.GetDefaultAudioEndpoint(flow, Role.Console); }
        catch { return null; }
    }

    private static bool ReadMuted(MMDevice device)
    {
        try { return device.AudioEndpointVolume.Mute; }
        catch { return false; }
    }
}

internal sealed class CaptureSession
{
    private static readonly WaveFormat OutputFormat = new(16_000, 16, 1);
    private readonly object gate = new();
    private readonly List<CaptureTrack> tracks = new();
    private readonly TaskCompletionSource<bool> stopped = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly Stopwatch clock = new();
    private int stopEvents;
    private bool startupComplete;
    private bool stopRequested;
    private string? failureMessage;

    private CaptureSession(CaptureInput[] inputs)
    {
        if (inputs.Length is < 1 or > 2) throw new ArgumentException("必须提供一到两路录音输入");
        var files = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var input in inputs)
        {
            if (input is null) throw new ArgumentException("输入数组不能包含 null");
            input.Source = input.Source?.Trim() ?? "";
            input.Kind = input.Kind?.Trim().ToLowerInvariant() ?? "";
            input.File = input.File?.Trim() ?? "";
            if (input.Kind is not ("microphone" or "system")) throw new ArgumentException("kind 必须是 microphone 或 system");
            if (string.IsNullOrWhiteSpace(input.File) || !string.Equals(Path.GetExtension(input.File), ".wav", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("每路输出文件必须使用 .wav 扩展名");
            if (!Path.IsPathFullyQualified(input.File)) throw new ArgumentException("输出文件必须是绝对路径");
            if (!files.Add(Path.GetFullPath(input.File))) throw new ArgumentException("每路输出文件必须不同");
        }
        if (inputs.Count(input => input.Kind == "microphone") > 1 || inputs.Count(input => input.Kind == "system") > 1)
            throw new ArgumentException("每种 kind 最多录制一路");
    }

    public static async Task RunAsync(CaptureInput[] inputs)
    {
        var session = new CaptureSession(inputs);
        await session.StartAsync(inputs);
    }

    private async Task StartAsync(CaptureInput[] inputs)
    {
        try
        {
            using var enumerator = new MMDeviceEnumerator();
            foreach (var input in inputs)
            {
                var monitor = input.Kind == "system";
                var device = DeviceCatalog.Resolve(enumerator, input.Source, monitor);
                WasapiCapture? capture = null;
                try
                {
                    capture = monitor ? new WasapiLoopbackCapture(device) : new WasapiCapture(device);
                    capture.WaveFormat = OutputFormat;
                    var parent = Path.GetDirectoryName(input.File);
                    if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                    tracks.Add(new CaptureTrack(input.Kind, input.File, device, capture));
                }
                catch
                {
                    try { capture?.Dispose(); }
                    finally { device.Dispose(); }
                    throw;
                }
            }

            foreach (var track in tracks) track.Attach(this);
            // One clock for both tracks. A loopback device may omit callbacks
            // while silent; CaptureTrack fills those wall-clock gaps with zeros.
            clock.Start();
            foreach (var track in tracks)
            {
                // NAudio can raise RecordingStopped on its capture thread before
                // StartRecording returns. Register and start under the same lock.
                lock (gate)
                {
                    if (stopRequested) break;
                    track.AwaitingStop = true;
                    stopEvents++;
                    try { track.Capture.StartRecording(); }
                    catch (Exception error)
                    {
                        track.AwaitingStop = false;
                        stopEvents--;
                        RequestStop(error);
                        break;
                    }
                }
            }
            lock (gate)
            {
                startupComplete = true;
                CompleteStopIfReady();
            }
            await WaitForCapturingAsync();
            Console.WriteLine("ready");
            Console.Out.Flush();
            await WaitForStopCommandAsync();
        }
        finally
        {
            lock (gate)
            {
                startupComplete = true;
                RequestStop();
            }
            try { await stopped.Task.WaitAsync(TimeSpan.FromSeconds(15)); }
            catch (TimeoutException error) { RequestStop(error); }
            foreach (var track in tracks)
            {
                try { track.Dispose(); }
                catch (Exception error) { RequestStop(error); }
            }
            lock (gate) tracks.Clear();
        }
        ThrowIfFailed();
    }

    private async Task WaitForCapturingAsync()
    {
        var deadline = Stopwatch.GetTimestamp() + Stopwatch.Frequency * 3;
        while (true)
        {
            lock (gate)
            {
                ThrowIfFailed();
                if (tracks.All(track => track.Capture.CaptureState == CaptureState.Capturing)) return;
            }
            if (Stopwatch.GetTimestamp() > deadline) throw new InvalidOperationException("录音设备未能进入 Capturing 状态");
            await Task.Delay(20);
        }
    }

    private async Task WaitForStopCommandAsync()
    {
        using var cancellation = new CancellationTokenSource();
        var command = ReadStopCommandAsync(cancellation.Token);
        await Task.WhenAny(command, stopped.Task);
        cancellation.Cancel();
        if (command.IsCompleted) await command;
    }

    private async Task ReadStopCommandAsync(CancellationToken cancellation)
    {
        try
        {
            using var input = Console.OpenStandardInput();
            var buffer = new byte[256];
            while (true)
            {
                var count = await input.ReadAsync(buffer.AsMemory(), cancellation);
                if (count == 0 || buffer.AsSpan(0, count).IndexOf((byte)'q') >= 0 || buffer.AsSpan(0, count).IndexOf((byte)'Q') >= 0) return;
            }
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { }
        catch (Exception error) { RequestStop(error); }
    }

    private void RequestStop(Exception? error = null)
    {
        lock (gate)
        {
            if (error is not null) failureMessage ??= error.Message;
            stopRequested = true;
            foreach (var track in tracks)
            {
                if (!track.AwaitingStop) continue;
                try { track.Capture.StopRecording(); }
                catch (Exception stopError) { failureMessage ??= stopError.Message; }
            }
            CompleteStopIfReady();
        }
    }

    private void CompleteStopIfReady()
    {
        if (startupComplete && stopRequested && stopEvents == 0) stopped.TrySetResult(true);
    }

    private void ThrowIfFailed()
    {
        lock (gate)
        {
            if (failureMessage is not null) throw new InvalidOperationException(failureMessage);
        }
    }

    private void TrackStopped(CaptureTrack track, StoppedEventArgs args)
    {
        lock (gate)
        {
            if (!track.AwaitingStop) return;
            track.AwaitingStop = false;
            if (args.Exception is not null) RequestStop(args.Exception);
            else if (!stopRequested) RequestStop(new InvalidOperationException($"录音音轨意外停止：{track.Kind}"));
        }
        try { track.PadToClock(clock.Elapsed); }
        catch (Exception error) { RequestStop(error); }
        finally
        {
            lock (gate)
            {
                stopEvents--;
                CompleteStopIfReady();
            }
        }
    }

    private sealed class CaptureTrack : IDisposable
    {
        private readonly object gate = new();
        private static readonly byte[] Silence = new byte[16_000 * OutputFormat.BlockAlign];
        private readonly MMDevice device;
        private readonly WaveFileWriter writer;
        private long framesWritten;
        public string Kind { get; }
        public bool AwaitingStop { get; set; }
        public WasapiCapture Capture { get; }

        public CaptureTrack(string kind, string file, MMDevice device, WasapiCapture capture)
        {
            Kind = kind;
            this.device = device;
            Capture = capture;
            writer = new WaveFileWriter(file, OutputFormat);
        }

        public void Attach(CaptureSession owner)
        {
            Capture.DataAvailable += (_, data) =>
            {
                try { WriteTimed(data.Buffer, data.BytesRecorded, owner.clock.Elapsed); }
                catch (Exception error) { owner.RequestStop(error); }
            };
            Capture.RecordingStopped += (_, args) => owner.TrackStopped(this, args);
        }

        private void WriteTimed(byte[] buffer, int bytes, TimeSpan elapsed)
        {
            lock (gate)
            {
                var inputFrames = bytes / OutputFormat.BlockAlign;
                var targetEnd = (long)Math.Max(0, Math.Round(elapsed.TotalSeconds * OutputFormat.SampleRate));
                var targetStart = Math.Max(0, targetEnd - inputFrames);
                WriteSilence(Math.Max(0, targetStart - framesWritten));
                writer.Write(buffer, 0, bytes);
                framesWritten += inputFrames;
            }
        }

        public void PadToClock(TimeSpan elapsed)
        {
            lock (gate)
            {
                var target = (long)Math.Max(0, Math.Round(elapsed.TotalSeconds * OutputFormat.SampleRate));
                WriteSilence(Math.Max(0, target - framesWritten));
                writer.Flush();
            }
        }

        private void WriteSilence(long frames)
        {
            const int ChunkFrames = 16_000;
            while (frames > 0)
            {
                var count = (int)Math.Min(frames, ChunkFrames);
                writer.Write(Silence, 0, count * OutputFormat.BlockAlign);
                framesWritten += count;
                frames -= count;
            }
        }

        public void Dispose()
        {
            // Dispose joins the capture thread; callbacks must finish before
            // closing their writer. Never hold the writer lock while joining.
            try { Capture.Dispose(); }
            finally
            {
                try { lock (gate) writer.Dispose(); }
                finally { device.Dispose(); }
            }
        }
    }
}
