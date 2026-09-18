import { useState, useRef, useEffect } from 'react'
import { Send, Loader2, Info, BookOpen, ArrowRight } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface 消息 {
  角色: '用户' | '助手'
  内容: string
  命中补充?: boolean
  引用?: Array<{ ref: string; title: string }>
}

interface Props {
  notebookId: string
}

export default function ChatPanel({ notebookId }: Props) {
  const [消息列表, set消息列表] = useState<消息[]>([])
  const [输入文字, set输入文字] = useState('')
  const [正在思考, set正在思考] = useState(false)
  const [追问建议, set追问建议] = useState<string[]>([])
  const [加载中, set加载中] = useState(true)
  const [错误, set错误] = useState('')
  const 底部引用 = useRef<HTMLDivElement>(null)
  const 提交锁 = useRef(false)
  const 存活 = useRef(true)

  useEffect(() => {
    存活.current = true
    window.knowmind.ai.history(notebookId).then(history => {
      if (存活.current) set消息列表(history.map(m => ({
        角色: m.role === 'user' ? '用户' : '助手', 内容: m.content, 引用: JSON.parse(m.citations_json)
      })))
    }).catch(err => { if (存活.current) set错误(`加载对话失败：${err.message}`) })
      .finally(() => { if (存活.current) set加载中(false) })
    return () => { 存活.current = false }
  }, [notebookId])

  useEffect(() => {
    底部引用.current?.scrollIntoView({ behavior: 'smooth' })
  }, [消息列表, 追问建议])

  const 发送问题 = async (问题文本?: string) => {
    const 问题 = (问题文本 || 输入文字).trim()
    if (!问题 || 提交锁.current || 加载中) return
    提交锁.current = true
    set错误('')
    set输入文字('')
    set追问建议([])
    set消息列表(prev => [...prev, { 角色: '用户', 内容: 问题 }])
    set正在思考(true)

    try {
      const result = await window.knowmind.ai.query(notebookId, 问题)
      window.dispatchEvent(new CustomEvent('knowmind:knowledge-changed', { detail: notebookId }))
      if (!存活.current) return
      if (result.warning) set错误(result.warning)
      set消息列表(prev => [...prev, {
        角色: '助手',
        内容: result.answer,
        命中补充: result.fromSupplement,
        引用: result.citations
      }])
      if (result.followUpQuestions && result.followUpQuestions.length > 0) {
        set追问建议(result.followUpQuestions)
      }
    } catch (err: any) {
      if (!存活.current) return
      set消息列表(prev => [...prev, {
        角色: '助手',
        内容: 'AI 调用失败: ' + (err.message || String(err))
      }])
    } finally {
      提交锁.current = false
      if (存活.current) set正在思考(false)
    }
  }

  const 按键处理 = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      发送问题()
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-white dark:bg-zinc-950" aria-label="知识问答">
      <h1 className="text-lg font-semibold px-6 pt-5 pb-2">知识问答</h1>
      {错误 && <p role="alert" className="text-sm text-amber-700 px-6 py-2 break-words">{错误}</p>}
      {加载中 && <Loader2 className="animate-spin mx-auto my-5" />}
      {消息列表.length > 0 && (
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-3 space-y-3">
          {消息列表.map((msg, i) => (
            <div
              key={i}
              className={`flex gap-2 text-sm ${
                msg.角色 === '用户' ? 'justify-end' : 'justify-start'
              }`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 whitespace-pre-wrap leading-relaxed ${
                  msg.角色 === '用户'
                    ? 'bg-primary-500 text-white'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200'
                }`}
              >
                {msg.命中补充 && (
                  <div className="flex items-center gap-1 mb-1 text-[11px] opacity-70">
                    <Info className="w-3 h-3" />
                    已从补充文件中找到答案
                  </div>
                )}
                <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children }) => <span>{children}</span> }}>{msg.内容}</ReactMarkdown></div>
                {msg.引用 && msg.引用.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-700 flex items-start gap-1 flex-wrap">
                    <BookOpen className="w-3 h-3 mt-0.5 text-zinc-400 shrink-0" />
                    {msg.引用.map(c => (
                      <span key={c.ref} className="text-[11px] px-1.5 py-0.5 rounded bg-primary-50 dark:bg-primary-900 text-primary-600 dark:text-primary-400" title={c.title}>
                        {c.ref}: {c.title}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {正在思考 && (
            <div className="flex gap-2 text-sm">
              <div className="max-w-[80%] rounded-lg px-3 py-2 bg-zinc-100 dark:bg-zinc-800">
                <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
              </div>
            </div>
          )}
          {追问建议.length > 0 && (
            <div className="flex gap-2 text-sm justify-start">
              <div className="max-w-[80%] rounded-lg px-3 py-2 bg-zinc-50 dark:bg-zinc-850 border border-zinc-200 dark:border-zinc-700">
                <p className="text-[11px] text-zinc-400 mb-2">继续追问</p>
                <div className="flex flex-wrap gap-1.5">
                  {追问建议.map((q, idx) => (
                    <button
                      key={idx}
                      onClick={() => 发送问题(q)}
                      disabled={正在思考}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-full bg-primary-50 dark:bg-primary-950 text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900 border border-primary-200 dark:border-primary-800 transition-colors disabled:opacity-50"
                    >
                      {q}
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div ref={底部引用} />
        </div>
      )}

      <div className="px-6 py-3 mt-auto border-t border-zinc-200 dark:border-zinc-800">
        <div className="flex items-end gap-2">
          <textarea
            value={输入文字}
            onChange={e => set输入文字(e.target.value)}
            onKeyDown={按键处理}
            placeholder="基于知识来源提问（如：数据库相关的问题怎么准备？）"
            rows={2}
            aria-label="问题"
            maxLength={12000}
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 outline-none focus:border-primary-500 resize-none"
          />
          <button
            onClick={() => 发送问题()}
            disabled={!输入文字.trim() || 正在思考 || 加载中}
            title="发送问题"
            aria-label="发送问题"
            className="px-3 py-2 rounded-lg bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50 transition-colors"
          >
            {正在思考 ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
