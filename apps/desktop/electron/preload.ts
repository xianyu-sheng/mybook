import { contextBridge, ipcRenderer } from 'electron'
import type { InterviewInput } from '../src/types/interview.js'
import type { RepositoryInput } from '../src/types/repository.js'
import type { CodingAttemptInput, CodingRunInput, CodingStrategyInput, CodingStrategyStatus, CodingProblemStatus } from '../src/types/coding.js'

/**
 * KnowMind API — 通过 contextBridge 暴露给 Renderer Process 的安全接口。
 * 所有 AI 调用和文件系统操作都走 Main Process，Renderer 不直接访问底层资源。
 */
const knowmindApi = {
  /** 应用健康检查 */
  ping: () => ipcRenderer.invoke('knowmind:ping'),

  practice: {
    list: () => ipcRenderer.invoke('knowmind:practice:list'),
    get: (id: string) => ipcRenderer.invoke('knowmind:practice:get', id),
    fromRecording: (id: string, index: number) => ipcRenderer.invoke('knowmind:practice:from-recording', id, index),
    fromInterview: (id: string) => ipcRenderer.invoke('knowmind:practice:from-interview', id),
    fromCard: (id: string) => ipcRenderer.invoke('knowmind:practice:from-card', id),
    attempt: (id: string, answer: string) => ipcRenderer.invoke('knowmind:practice:attempt', id, answer),
    retry: (id: string) => ipcRenderer.invoke('knowmind:practice:retry', id),
    setStatus: (id: string, status: string) => ipcRenderer.invoke('knowmind:practice:set-status', id, status),
    delete: (id: string) => ipcRenderer.invoke('knowmind:practice:delete', id),
  },
  coding: {
    listStrategies: () => ipcRenderer.invoke('knowmind:coding:strategies:list'),
    getStrategy: (id: string) => ipcRenderer.invoke('knowmind:coding:strategies:get', id),
    createStrategy: (input: CodingStrategyInput) => ipcRenderer.invoke('knowmind:coding:strategies:create', input),
    updateStrategy: (id: string, patch: Partial<CodingStrategyInput> & { status?: CodingStrategyStatus }) => ipcRenderer.invoke('knowmind:coding:strategies:update', id, patch),
    deleteStrategy: (id: string) => ipcRenderer.invoke('knowmind:coding:strategies:delete', id),
    search: (id: string) => ipcRenderer.invoke('knowmind:coding:strategies:search', id),
    plan: (id: string) => ipcRenderer.invoke('knowmind:coding:strategies:plan', id),
    problems: (id: string) => ipcRenderer.invoke('knowmind:coding:strategies:problems', id),
    updateProblemStatus: (id: string, status: CodingProblemStatus) => ipcRenderer.invoke('knowmind:coding:problems:status', id, status),
    saveAttempt: (input: CodingAttemptInput) => ipcRenderer.invoke('knowmind:coding:strategies:attempt', input),
    runCode: (input: CodingRunInput) => ipcRenderer.invoke('knowmind:coding:run', input),
    reviewAttempt: (id: string) => ipcRenderer.invoke('knowmind:coding:strategies:review', id),
    sync: (id: string, platform: 'leetcode' | 'nowcoder') => ipcRenderer.invoke('knowmind:coding:strategies:sync', id, platform),
    openSource: (id: string, url: string) => ipcRenderer.invoke('knowmind:coding:open-source', id, url),
  },
  targets: {
    list: () => ipcRenderer.invoke('knowmind:targets:list'),
    save: (input: import('../src/types/target.js').TargetInput, id?: string) => ipcRenderer.invoke('knowmind:targets:save', input, id),
    delete: (id: string) => ipcRenderer.invoke('knowmind:targets:delete', id),
  },

  recordings: {
    devices: () => ipcRenderer.invoke('knowmind:recordings:devices'),
    state: () => ipcRenderer.invoke('knowmind:recordings:state'),
    setup: () => ipcRenderer.invoke('knowmind:recordings:setup'),
    list: () => ipcRenderer.invoke('knowmind:recordings:list'),
    get: (id: string) => ipcRenderer.invoke('knowmind:recordings:get', id),
    start: (input: unknown) => ipcRenderer.invoke('knowmind:recordings:start', input),
    stop: () => ipcRenderer.invoke('knowmind:recordings:stop'),
    importAudio: (input: unknown) => ipcRenderer.invoke('knowmind:recordings:import', input),
    transcribe: (id: string, language: string) => ipcRenderer.invoke('knowmind:recordings:transcribe', id, language),
    analyze: (id: string) => ipcRenderer.invoke('knowmind:recordings:analyze', id),
    cancel: () => ipcRenderer.invoke('knowmind:recordings:cancel'),
    saveTranscript: (id: string, segments: unknown) => ipcRenderer.invoke('knowmind:recordings:save-transcript', id, segments),
    update: (id: string, patch: unknown) => ipcRenderer.invoke('knowmind:recordings:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('knowmind:recordings:delete', id),
    export: (id: string) => ipcRenderer.invoke('knowmind:recordings:export', id),
    onState: (callback: (state: import('../src/types/recording.js').RecordingState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: import('../src/types/recording.js').RecordingState) => callback(state)
      ipcRenderer.on('knowmind:recordings:state', listener)
      return () => ipcRenderer.removeListener('knowmind:recordings:state', listener)
    },
  },

  // ---- Notebook ----
  notebooks: {
    create: (title: string, description?: string, template?: string) =>
      ipcRenderer.invoke('knowmind:notebook:create', title, description, template),
    list: () => ipcRenderer.invoke('knowmind:notebook:list'),
    listArchived: () => ipcRenderer.invoke('knowmind:notebook:list-archived'),
    archive: (id: string) => ipcRenderer.invoke('knowmind:notebook:archive', id),
    restore: (id: string) => ipcRenderer.invoke('knowmind:notebook:restore', id),
    get: (id: string) => ipcRenderer.invoke('knowmind:notebook:get', id),
    update: (id: string, patch: Record<string, unknown>) =>
      ipcRenderer.invoke('knowmind:notebook:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('knowmind:notebook:delete', id)
  },

  // ---- Source ----
  sources: {
    upload: (notebookId: string, filePath: string) =>
      ipcRenderer.invoke('knowmind:source:upload', notebookId, filePath),
    addUrl: (notebookId: string, url: string) =>
      ipcRenderer.invoke('knowmind:source:add-url', notebookId, url),
    list: (notebookId: string) =>
      ipcRenderer.invoke('knowmind:source:list', notebookId),
    get: (id: string) => ipcRenderer.invoke('knowmind:source:get', id),
    delete: (id: string) => ipcRenderer.invoke('knowmind:source:delete', id),
    getContent: (id: string) =>
      ipcRenderer.invoke('knowmind:source:get-content', id),
    getSummary: (id: string) =>
      ipcRenderer.invoke('knowmind:source:get-summary', id)
  },

  // ---- Card ----
  cards: {
    onProgress: (callback: (progress: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress)
      ipcRenderer.on('knowmind:card:progress', listener)
      return () => ipcRenderer.removeListener('knowmind:card:progress', listener)
    },
    generate: (notebookId: string, count?: number, mode?: string) =>
      ipcRenderer.invoke('knowmind:card:generate', notebookId, count, mode),
    list: (notebookId: string) =>
      ipcRenderer.invoke('knowmind:card:list', notebookId),
    get: (id: string) => ipcRenderer.invoke('knowmind:card:get', id),
    expandDetail: (cardId: string) =>
      ipcRenderer.invoke('knowmind:card:expand-detail', cardId),
    update: (cardId: string, patch: Record<string, unknown>) =>
      ipcRenderer.invoke('knowmind:card:update', cardId, patch),
    delete: (cardId: string) =>
      ipcRenderer.invoke('knowmind:card:delete', cardId)
  },

  // ---- AI ----
  ai: {
    history: (notebookId: string) => ipcRenderer.invoke('knowmind:ai:history', notebookId),
    query: (notebookId: string, question: string) =>
      ipcRenderer.invoke('knowmind:ai:query', notebookId, question),
    listModels: () => ipcRenderer.invoke('knowmind:ai:list-models'),
    setActiveModel: (modelKey: string) =>
      ipcRenderer.invoke('knowmind:ai:set-active-model', modelKey),
    testConnection: (modelKey: string) =>
      ipcRenderer.invoke('knowmind:ai:test-connection', modelKey)
  },

  // ---- Supplement ----
  supplement: {
    list: (notebookId: string) =>
      ipcRenderer.invoke('knowmind:supplement:list', notebookId),
    export: (notebookId: string) =>
      ipcRenderer.invoke('knowmind:supplement:export', notebookId),
    exportMd: (notebookId: string) =>
      ipcRenderer.invoke('knowmind:supplement:export', notebookId),
    getContent: (id: string) =>
      ipcRenderer.invoke('knowmind:supplement:get-content', id),
    delete: (id: string) =>
      ipcRenderer.invoke('knowmind:supplement:delete', id)
  },

  // ---- Settings ----
  settings: {
    get: (key: string) => ipcRenderer.invoke('knowmind:settings:get', key),
    set: (key: string, value: unknown) =>
      ipcRenderer.invoke('knowmind:settings:set', key, value),
    getAll: () => ipcRenderer.invoke('knowmind:settings:get-all')
  },

  repositories: {
    list: () => ipcRenderer.invoke('knowmind:repositories:list'),
    create: (input: RepositoryInput) => ipcRenderer.invoke('knowmind:repositories:create', input),
    update: (id: string, patch: Partial<Omit<RepositoryInput, 'base_url'>>) => ipcRenderer.invoke('knowmind:repositories:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('knowmind:repositories:delete', id),
    sync: (id: string) => ipcRenderer.invoke('knowmind:repositories:sync', id),
    cancel: (id: string) => ipcRenderer.invoke('knowmind:repositories:cancel', id),
    importPack: () => ipcRenderer.invoke('knowmind:repositories:import'),
    exportPack: () => ipcRenderer.invoke('knowmind:repositories:export'),
    documents: (query: string, repositoryId?: string, page?: number) => ipcRenderer.invoke('knowmind:repositories:documents', query, repositoryId, page),
    document: (id: string) => ipcRenderer.invoke('knowmind:repositories:document', id),
    openDocument: (id: string) => ipcRenderer.invoke('knowmind:repositories:open-document', id)
  },

  // ---- Dialog ----
  dialog: {
    openFile: (filters?: Array<{ name: string; extensions: string[] }>) =>
      ipcRenderer.invoke('knowmind:dialog:open-file', filters),
    openFiles: (filters?: Array<{ name: string; extensions: string[] }>) =>
      ipcRenderer.invoke('knowmind:dialog:open-files', filters),
    openDirectory: () =>
      ipcRenderer.invoke('knowmind:dialog:open-directory')
  },

  // ---- Platform auth ----
  interviews: {
    list: (notebookId: string) => ipcRenderer.invoke('knowmind:interviews:list', notebookId),
    get: (id: string) => ipcRenderer.invoke('knowmind:interviews:get', id),
    create: (notebookId: string, input: InterviewInput) => ipcRenderer.invoke('knowmind:interviews:create', notebookId, input),
    update: (id: string, patch: { title: string; tags: string[] }) => ipcRenderer.invoke('knowmind:interviews:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('knowmind:interviews:delete', id),
    research: (id: string) => ipcRenderer.invoke('knowmind:interviews:research', id),
    start: (id: string) => ipcRenderer.invoke('knowmind:interviews:start', id),
    answer: (id: string, turnId: string, answer: string) => ipcRenderer.invoke('knowmind:interviews:answer', id, turnId, answer),
    retryAnswer: (id: string, turnId: string) => ipcRenderer.invoke('knowmind:interviews:retry-answer', id, turnId),
    finish: (id: string) => ipcRenderer.invoke('knowmind:interviews:finish', id),
    export: (id: string) => ipcRenderer.invoke('knowmind:interviews:export', id),
    openSource: (id: string, url: string) => ipcRenderer.invoke('knowmind:interviews:open-source', id, url)
  },
  auth: {
    save: (auth: unknown) => ipcRenderer.invoke('knowmind:auth:save', auth),
    get: (platform: string) => ipcRenderer.invoke('knowmind:auth:get', platform),
    status: () => ipcRenderer.invoke('knowmind:auth:status'),
    disconnect: (platform: string) => ipcRenderer.invoke('knowmind:auth:disconnect', platform),
    githubConnect: () => ipcRenderer.invoke('knowmind:auth:github-connect'),
    leetcodeLogin: () => ipcRenderer.invoke('knowmind:auth:leetcode-login'),
    nowcoderLogin: () => ipcRenderer.invoke('knowmind:auth:nowcoder-login'),
    saveCookie: (platform: string, cookie: string) => ipcRenderer.invoke('knowmind:auth:save-cookie', platform, cookie),
    importData: (notebookId: string, platform: string) => ipcRenderer.invoke('knowmind:auth:import-data', notebookId, platform)
  }
}

contextBridge.exposeInMainWorld('knowmind', knowmindApi)

export type KnowMindApi = typeof knowmindApi
