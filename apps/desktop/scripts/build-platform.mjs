import { spawnSync } from 'node:child_process'

// Linux and macOS keep using their existing capture/import paths. Windows
// builds the self-contained NAudio helper before Electron packages the app.
if (process.platform === 'win32') {
  const result = spawnSync('dotnet', [
    'publish', 'native/windows-audio/Mybook.WindowsAudio.csproj',
    '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true',
    '/p:PublishSingleFile=true', '/p:IncludeNativeLibrariesForSelfExtract=true',
    '-o', 'native/windows-audio/publish',
  ], { stdio: 'inherit', shell: false })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
