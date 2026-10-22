const { contextBridge, ipcRenderer } = require('electron');

// Mybook API — 通过 contextBridge 暴露给渲染进程
const knowmindApi = {
  ping: () => ipcRenderer.invoke('knowmind:ping'),

  practice: {
    list: () => ipcRenderer.invoke('knowmind:practice:list'),
    get: id => ipcRenderer.invoke('knowmind:practice:get', id),
    fromRecording: (id, index) => ipcRenderer.invoke('knowmind:practice:from-recording', id, index),
    fromInterview: id => ipcRenderer.invoke('knowmind:practice:from-interview', id),
    fromCard: id => ipcRenderer.invoke('knowmind:practice:from-card', id),
    attempt: (id, answer) => ipcRenderer.invoke('knowmind:practice:attempt', id, answer),
    retry: id => ipcRenderer.invoke('knowmind:practice:retry', id),
    setStatus: (id, status) => ipcRenderer.invoke('knowmind:practice:set-status', id, status),
    delete: id => ipcRenderer.invoke('knowmind:practice:delete', id),
  },
  coding: {
    listStrategies: () => ipcRenderer.invoke('knowmind:coding:strategies:list'),
    getStrategy: id => ipcRenderer.invoke('knowmind:coding:strategies:get', id),
    createStrategy: input => ipcRenderer.invoke('knowmind:coding:strategies:create', input),
    updateStrategy: (id, patch) => ipcRenderer.invoke('knowmind:coding:strategies:update', id, patch),
    deleteStrategy: id => ipcRenderer.invoke('knowmind:coding:strategies:delete', id),
    search: id => ipcRenderer.invoke('knowmind:coding:strategies:search', id),
    plan: id => ipcRenderer.invoke('knowmind:coding:strategies:plan', id),
    problems: id => ipcRenderer.invoke('knowmind:coding:strategies:problems', id),
    updateProblemStatus: (id, status) => ipcRenderer.invoke('knowmind:coding:problems:status', id, status),
    saveAttempt: input => ipcRenderer.invoke('knowmind:coding:strategies:attempt', input),
    runCode: input => ipcRenderer.invoke('knowmind:coding:run', input),
    reviewAttempt: id => ipcRenderer.invoke('knowmind:coding:strategies:review', id),
    sync: (id, platform) => ipcRenderer.invoke('knowmind:coding:strategies:sync', id, platform),
    openSource: (id, url) => ipcRenderer.invoke('knowmind:coding:open-source', id, url),
  },
  targets: {
    list: () => ipcRenderer.invoke('knowmind:targets:list'),
    save: (input, id) => ipcRenderer.invoke('knowmind:targets:save', input, id),
    delete: id => ipcRenderer.invoke('knowmind:targets:delete', id),
  },

  recordings: {
    devices: () => ipcRenderer.invoke('knowmind:recordings:devices'),
    state: () => ipcRenderer.invoke('knowmind:recordings:state'),
    setup: () => ipcRenderer.invoke('knowmind:recordings:setup'),
    list: () => ipcRenderer.invoke('knowmind:recordings:list'),
    get: id => ipcRenderer.invoke('knowmind:recordings:get', id),
    start: input => ipcRenderer.invoke('knowmind:recordings:start', input),
    stop: () => ipcRenderer.invoke('knowmind:recordings:stop'),
    importAudio: input => ipcRenderer.invoke('knowmind:recordings:import', input),
    transcribe: (id, language) => ipcRenderer.invoke('knowmind:recordings:transcribe', id, language),
    analyze: id => ipcRenderer.invoke('knowmind:recordings:analyze', id),
    cancel: () => ipcRenderer.invoke('knowmind:recordings:cancel'),
    saveTranscript: (id, segments) => ipcRenderer.invoke('knowmind:recordings:save-transcript', id, segments),
    update: (id, patch) => ipcRenderer.invoke('knowmind:recordings:update', id, patch),
    delete: id => ipcRenderer.invoke('knowmind:recordings:delete', id),
    export: id => ipcRenderer.invoke('knowmind:recordings:export', id),
    onState: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('knowmind:recordings:state', listener)
      return () => ipcRenderer.removeListener('knowmind:recordings:state', listener)
    },
  },

  notebooks: {
    create: (title, description, template) => ipcRenderer.invoke('knowmind:notebook:create', title, description, template),
    list: () => ipcRenderer.invoke('knowmind:notebook:list'),
    listArchived: () => ipcRenderer.invoke('knowmind:notebook:list-archived'),
    archive: id => ipcRenderer.invoke('knowmind:notebook:archive', id),
    restore: id => ipcRenderer.invoke('knowmind:notebook:restore', id),
    get: (id) => ipcRenderer.invoke('knowmind:notebook:get', id),
    update: (id, patch) => ipcRenderer.invoke('knowmind:notebook:update', id, patch),
    delete: (id) => ipcRenderer.invoke('knowmind:notebook:delete', id)
  },

  sources: {
    upload: (notebookId, filePath) => ipcRenderer.invoke('knowmind:source:upload', notebookId, filePath),
    addUrl: (notebookId, url) => ipcRenderer.invoke('knowmind:source:add-url', notebookId, url),
    list: (notebookId) => ipcRenderer.invoke('knowmind:source:list', notebookId),
    get: (id) => ipcRenderer.invoke('knowmind:source:get', id),
    delete: (id) => ipcRenderer.invoke('knowmind:source:delete', id),
    getContent: (id) => ipcRenderer.invoke('knowmind:source:get-content', id),
    getSummary: (id) => ipcRenderer.invoke('knowmind:source:get-summary', id)
  },

  cards: {
    onProgress: (callback) => {
      const listener = (_event, progress) => callback(progress)
      ipcRenderer.on('knowmind:card:progress', listener)
      return () => ipcRenderer.removeListener('knowmind:card:progress', listener)
    },
    generate: (notebookId, count, mode) => ipcRenderer.invoke('knowmind:card:generate', notebookId, count, mode),
    list: (notebookId) => ipcRenderer.invoke('knowmind:card:list', notebookId),
    get: (id) => ipcRenderer.invoke('knowmind:card:get', id),
    expandDetail: (cardId) => ipcRenderer.invoke('knowmind:card:expand-detail', cardId),
    update: (cardId, patch) => ipcRenderer.invoke('knowmind:card:update', cardId, patch),
    delete: (cardId) => ipcRenderer.invoke('knowmind:card:delete', cardId)
  },

  ai: {
    history: (notebookId) => ipcRenderer.invoke('knowmind:ai:history', notebookId),
    query: (notebookId, question) => ipcRenderer.invoke('knowmind:ai:query', notebookId, question),
    listModels: () => ipcRenderer.invoke('knowmind:ai:list-models'),
    listProviders: () => ipcRenderer.invoke('knowmind:ai:providers:list'),
    saveProvider: (input) => ipcRenderer.invoke('knowmind:ai:providers:save', input),
    deleteProvider: (id) => ipcRenderer.invoke('knowmind:ai:providers:delete', id),
    setActiveModel: (modelKey) => ipcRenderer.invoke('knowmind:ai:set-active-model', modelKey),
    testConnection: (modelKey) => ipcRenderer.invoke('knowmind:ai:test-connection', modelKey),
    listSessions: () => ipcRenderer.invoke('knowmind:ai:sessions:list'),
    createSession: (title) => ipcRenderer.invoke('knowmind:ai:sessions:create', title),
    renameSession: (id, title) => ipcRenderer.invoke('knowmind:ai:sessions:rename', id, title),
    deleteSession: (id) => ipcRenderer.invoke('knowmind:ai:sessions:delete', id),
    sessionHistory: (id) => ipcRenderer.invoke('knowmind:ai:session-history', id),
    sessionQuery: (id, question) => ipcRenderer.invoke('knowmind:ai:session-query', id, question)
  },

  supplement: {
    list: (notebookId) => ipcRenderer.invoke('knowmind:supplement:list', notebookId),
    export: (notebookId) => ipcRenderer.invoke('knowmind:supplement:export', notebookId),
    exportMd: (notebookId) => ipcRenderer.invoke('knowmind:supplement:export', notebookId),
    getContent: (id) => ipcRenderer.invoke('knowmind:supplement:get-content', id),
    delete: (id) => ipcRenderer.invoke('knowmind:supplement:delete', id)
  },

  settings: {
    get: (key) => ipcRenderer.invoke('knowmind:settings:get', key),
    set: (key, value) => ipcRenderer.invoke('knowmind:settings:set', key, value),
    getAll: () => ipcRenderer.invoke('knowmind:settings:get-all')
  },

  repositories: {
    list: () => ipcRenderer.invoke('knowmind:repositories:list'),
    create: (input) => ipcRenderer.invoke('knowmind:repositories:create', input),
    update: (id, patch) => ipcRenderer.invoke('knowmind:repositories:update', id, patch),
    delete: (id) => ipcRenderer.invoke('knowmind:repositories:delete', id),
    sync: (id) => ipcRenderer.invoke('knowmind:repositories:sync', id),
    cancel: (id) => ipcRenderer.invoke('knowmind:repositories:cancel', id),
    importPack: () => ipcRenderer.invoke('knowmind:repositories:import'),
    exportPack: () => ipcRenderer.invoke('knowmind:repositories:export'),
    documents: (query, repositoryId, page) => ipcRenderer.invoke('knowmind:repositories:documents', query, repositoryId, page),
    document: (id) => ipcRenderer.invoke('knowmind:repositories:document', id),
    openDocument: (id) => ipcRenderer.invoke('knowmind:repositories:open-document', id)
  },

  interviews: {
    list: (notebookId) => ipcRenderer.invoke('knowmind:interviews:list', notebookId),
    get: (id) => ipcRenderer.invoke('knowmind:interviews:get', id),
    create: (notebookId, input) => ipcRenderer.invoke('knowmind:interviews:create', notebookId, input),
    update: (id, patch) => ipcRenderer.invoke('knowmind:interviews:update', id, patch),
    delete: (id) => ipcRenderer.invoke('knowmind:interviews:delete', id),
    research: (id) => ipcRenderer.invoke('knowmind:interviews:research', id),
    start: (id) => ipcRenderer.invoke('knowmind:interviews:start', id),
    answer: (id, turnId, answer) => ipcRenderer.invoke('knowmind:interviews:answer', id, turnId, answer),
    retryAnswer: (id, turnId) => ipcRenderer.invoke('knowmind:interviews:retry-answer', id, turnId),
    finish: (id) => ipcRenderer.invoke('knowmind:interviews:finish', id),
    export: (id) => ipcRenderer.invoke('knowmind:interviews:export', id),
    openSource: (id, url) => ipcRenderer.invoke('knowmind:interviews:open-source', id, url)
  },

  dialog: {
    openFile: (filters) => ipcRenderer.invoke('knowmind:dialog:open-file', filters),
    openFiles: (filters) => ipcRenderer.invoke('knowmind:dialog:open-files', filters),
    openDirectory: () => ipcRenderer.invoke('knowmind:dialog:open-directory')
  },

  auth: {
    save: (auth) => ipcRenderer.invoke('knowmind:auth:save', auth),
    get: (platform) => ipcRenderer.invoke('knowmind:auth:get', platform),
    status: () => ipcRenderer.invoke('knowmind:auth:status'),
    disconnect: (platform) => ipcRenderer.invoke('knowmind:auth:disconnect', platform),
    githubConnect: () => ipcRenderer.invoke('knowmind:auth:github-connect'),
    leetcodeLogin: () => ipcRenderer.invoke('knowmind:auth:leetcode-login'),
    nowcoderLogin: () => ipcRenderer.invoke('knowmind:auth:nowcoder-login'),
    saveCookie: (platform, cookieStr) => ipcRenderer.invoke('knowmind:auth:save-cookie', platform, cookieStr),
    importData: (notebookId, platform) => ipcRenderer.invoke('knowmind:auth:import-data', notebookId, platform)
  }
};

contextBridge.exposeInMainWorld('knowmind', knowmindApi);
