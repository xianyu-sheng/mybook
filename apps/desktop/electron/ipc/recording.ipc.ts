import { dialog, ipcMain, protocol } from 'electron'
import { writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { audioDevices } from '../recording/audio.js'
import { audioResponse } from '../recording/playback.js'
import { recordingMarkdown } from '../recording/documents.js'
import { analyze, audioPath, cancelJob, deleteRecording, getRecording, importAudio, installSpeech, listRecordings,
  recordingInput, recordingState, saveTranscript, startRecording, stopRecording, transcribeRecording, updateRecording } from '../recording/service.js'

export function registerRecordingIpc() {
  ipcMain.handle('knowmind:recordings:devices', () => audioDevices())
  ipcMain.handle('knowmind:recordings:state', () => recordingState())
  ipcMain.handle('knowmind:recordings:setup', () => installSpeech())
  ipcMain.handle('knowmind:recordings:list', () => listRecordings())
  ipcMain.handle('knowmind:recordings:get', (_, id: string) => getRecording(id))
  ipcMain.handle('knowmind:recordings:start', (_, input: unknown) => startRecording(input))
  ipcMain.handle('knowmind:recordings:stop', () => stopRecording())
  ipcMain.handle('knowmind:recordings:import', async (_, value: unknown) => {
    const input = recordingInput.parse(value)
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '音频和视频', extensions: ['wav', 'flac', 'mp3', 'm4a', 'ogg', 'webm', 'mp4', 'aac'] }] })
    if (result.canceled || !result.filePaths[0]) return null
    return importAudio(input, result.filePaths[0])
  })
  ipcMain.handle('knowmind:recordings:transcribe', (_, id: string, language: string) => transcribeRecording(id, language))
  ipcMain.handle('knowmind:recordings:analyze', (_, id: string) => analyze(id))
  ipcMain.handle('knowmind:recordings:cancel', () => cancelJob())
  ipcMain.handle('knowmind:recordings:save-transcript', (_, id: string, segments: unknown) => saveTranscript(id, segments))
  ipcMain.handle('knowmind:recordings:update', (_, id: string, input: unknown) => updateRecording(id, input))
  ipcMain.handle('knowmind:recordings:delete', (_, id: string) => deleteRecording(id))
  ipcMain.handle('knowmind:recordings:export', async (_, id: string) => {
    const record = getRecording(id)
    const result = await dialog.showSaveDialog({ defaultPath: `${record.title.replace(/[\\/:*?"<>|]/g, '_')}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, recordingMarkdown(record), 'utf8')
    return result.filePath
  })
  protocol.handle('mybook-audio', async request => {
    try {
      const url = new URL(request.url)
      const [, id, track, extra] = url.pathname.split('/')
      if (url.hostname !== 'recording' || extra || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
      const file = audioPath(id, z.enum(['microphone', 'system', 'imported']).parse(track))
      return await audioResponse(request, file)
    } catch { return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } }) }
  })
}
