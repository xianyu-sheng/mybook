export interface RepositoryInput {
  name: string
  base_url: string
  homepage?: string
  description?: string
  enabled?: boolean
}
export interface GlobalRepository extends RepositoryInput {
  id: string
  homepage: string
  description: string
  enabled: boolean
  status: 'not_synced' | 'syncing' | 'ready' | 'error'
  last_synced_at: string | null
  last_error: string | null
  warning: string | null
  revision: string | null
  document_count: number
  progress: string | null
}
export interface RepositoryDocument {
  id: string
  repository_id: string
  repository_name: string
  path: string
  title: string
  url: string
  snippet: string
}
export interface RepositoryApi {
  list: () => Promise<GlobalRepository[]>
  create: (input: RepositoryInput) => Promise<GlobalRepository>
  update: (id: string, input: Partial<Omit<RepositoryInput, 'base_url'>>) => Promise<GlobalRepository>
  delete: (id: string) => Promise<void>
  sync: (id: string) => Promise<void>
  cancel: (id: string) => Promise<void>
  importPack: () => Promise<GlobalRepository[] | null>
  exportPack: () => Promise<string | null>
  documents: (query: string, repositoryId?: string, page?: number) => Promise<{ items: RepositoryDocument[]; total: number }>
  document: (id: string) => Promise<RepositoryDocument & { content_text: string }>
  openDocument: (id: string) => Promise<void>
}
