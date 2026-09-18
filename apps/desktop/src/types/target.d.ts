export interface TargetInput { company: string; department: string; role: string; jd: string }
export interface TargetRole extends TargetInput { id: string; created_at: string; updated_at: string }
export interface TargetApi {
  list: () => Promise<TargetRole[]>
  save: (input: TargetInput, id?: string) => Promise<TargetRole>
  delete: (id: string) => Promise<void>
}
