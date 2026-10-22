import { useEffect, useRef, useState } from 'react'
import { Send, Loader2, BookOpen, MessagesSquare } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface 消息 {
  角色: '用户' | '助手'
  内容: string
  引用?: Array<{ ref: string; title: string }>
}

interface Props {
  sessionId: string
  onChanged?: () => void
}

const 示例问题 = [
  '总结一下我两个项目的核心内容和量化结果',
  '我哪些面试回答最薄弱？应该怎么补',
  '帮我准备一段两分钟自我介绍',
]

function 解析引用(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.ref === 'string' && typeof item.title === 'string') : []
  } catch { return [] }
}

export default function ChatPanel({ sessionId, onChanged }: Props) {
  const [消息列表, set消息列表] = useState<消息[]>([])
  const [输入文字, set输入文字] = useState('')
  const [正在思考, set正在思考] = useState(false)
  const [追问建议, set追问建议] = useState<string[]>([])
  const [加载中, set加载中] = useState(true)
  const [错误, set错误] = useState('')
  const 底部引用 = useRef<HTMLDivElement>(null)
  const 提交锁 = useRef(false)
  const 存活 = useRef(true)
  const 请求序号 = useRef(0)
  const 当前会话 = useRef(sessionId)
  当前会话.current = sessionId

  useEffect(() => {
    存活.current = true
    const 序号 = ++请求序号.current
    set加载中(true)
    set错误('')
    set追问建议([])
    set消息列表([])
    window.knowmind.ai.sessionHistory(sessionId).then(history => {
      if (!存活.current || 请求序号.current !== 序号) return
      set消息列表(history.map(m => ({
        角色: m.role === 'user' ? '用户' : '助手',
        内容: m.content,
        引用: 解析引用(m.citations_json),
      })))
    }).catch(err => { if (存活.current && 请求序号.current === 序号) set错误(`加载对话失败：${err.message}`) })
      .finally(() => { if (存活.current && 请求序号.current === 序号) set加载中(false) })
    return () => { 存活.current = false }
  }, [sessionId])

  useEffect(() => {
    底部引用.current?.scrollIntoView({ behavior: 'smooth' })
  }, [消息列表, 追问建议])

  const 发送问题 = async (问题文本?: string) => {
    const 问题 = (问题文本 || 输入文字).trim()
    if (!问题 || 提交锁.current || 加载中) return
    const 发起会话 = sessionId
    提交锁.current = true
    set错误('')
    set输入文字('')
    set追问建议([])
    set消息列表(prev => [...prev, { 角色: '用户', 内容: 问题 }])
    set正在思考(true)

    try {
      const result = await window.knowmind.ai.sessionQuery(发起会话, 问题)
      if (!存活.current || 当前会话.current !== 发起会话) return
      if (result.warning) set错误(result.warning)
      if (result.error) set错误(result.answer)
      else {
        set消息列表(prev => [...prev, { 角色: '助手', 内容: result.answer, 引用: result.citations }])
        if (result.followUpQuestions?.length) set追问建议(result.followUpQuestions)
      }
    } catch (err: any) {
      if (!存活.current) return
      set错误('AI 调用失败: ' + (err.message || String(err)))
    } finally {
      提交锁.current = false
      if (存活.current) set正在思考(false)
      onChanged?.()
    }
  }

  const 按键处理 = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void 发送问题()
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-transparent" aria-label="知识问答">
      {错误 && <p role="alert" className="text-sm text-amber-700 px-6 py-2 break-words">{错误}</p>}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4">
        {加载中 && <Loader2 className="animate-spin mx-auto my-6" />}
        {!加载中 && !消息列表.length && (
          <div className="h-full flex items-center justify-center py-10">
            <div className="flex flex-col items-center text-center rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] backdrop-blur-xl px-8 py-10 max-w-xl">
            <div className="w-12 h-12 rounded-xl bg-[color:var(--app-hover)] flex items-center justify-center mb-4">
              <MessagesSquare className="w-6 h-6 text-zinc-400" />
            </div>
            <h2 className="text-base font-semibold mb-2">问一个跨资料库的问题</h2>
            <p className="text-sm text-zinc-500 max-w-md mb-5">
              会同时检索所有笔记本的资料与补充、全局知识库、共享的面试录音和历史问答。
            </p>
            <div className="flex flex-wrap justify-center gap-2 max-w-xl">
              {示例问题.map(question => (
                <button key={question} onClick={() => void 发送问题(question)}
                  className="px-3 py-1.5 text-xs rounded-full border border-[color:var(--app-border)] hover:bg-[color:var(--app-hover)]">
                  {question}
                </button>
              ))}
            </div>
            </div>
          </div>
        )}
        {消息列表.map((msg, i) => (
          <div key={i} className={`flex gap-2 text-sm ${msg.角色 === '用户' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 whitespace-pre-wrap leading-relaxed ${
              msg.角色 === '用户'
                ? 'bg-primary-500 text-white'
                : 'bg-[color:var(--app-surface)] backdrop-blur-md text-zinc-800 dark:text-zinc-200'
            }`}>
              <div className="markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children }) => <span>{children}</span> }}>
                  {msg.内容}
                </ReactMarkdown>
              </div>
              {!!msg.引用?.length && (
                <div className="mt-2 pt-2 border-t border-[color:var(--app-border)] flex items-start gap-1 flex-wrap">
                  <BookOpen className="w-3 h-3 mt-0.5 text-zinc-400 shrink-0" />
                  {msg.引用.map(citation => (
                    <span key={citation.ref} className="text-[11px] px-1.5 py-0.5 rounded bg-primary-50 dark:bg-primary-900 text-primary-600 dark:text-primary-400" title={citation.title}>
                      {citation.ref}: {citation.title}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {正在思考 && (
          <p className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="w-3.5 h-3.5 animate-spin" />正在检索资料并组织回答...</p>
        )}
        {!!追问建议.length && !正在思考 && (
          <div className="pl-1">
            <p className="text-xs text-zinc-400 mb-2">可以继续追问</p>
            <div className="flex flex-wrap gap-2">
              {追问建议.map(question => (
                <button key={question} onClick={() => void 发送问题(question)}
                  className="px-2.5 py-1 text-xs rounded-full border border-[color:var(--app-border)] hover:bg-[color:var(--app-hover)]">
                  {question}
                </button>
              ))}
            </div>
          </div>
        )}
        <div ref={底部引用} />
      </div>
      <div className="shrink-0 border-t border-[color:var(--app-border)] bg-[color:var(--app-surface)] backdrop-blur-xl p-4">
        <div className="flex items-end gap-2">
          <textarea
            aria-label="输入问题"
            value={输入文字}
            onChange={event => set输入文字(event.target.value)}
            onKeyDown={按键处理}
            placeholder="问一个跨全部资料的问题…（Enter 发送，Shift+Enter 换行）"
            rows={2}
            disabled={加载中 || 正在思考}
            className="flex-1 min-h-[44px] max-h-40 resize-y rounded-md border border-[color:var(--app-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-primary-500 disabled:opacity-50"
          />
          <button onClick={() => void 发送问题()} disabled={!输入文字.trim() || 加载中 || 正在思考}
            className="inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-40">
            <Send className="w-4 h-4" />发送
          </button>
        </div>
      </div>
    </div>
  )
}
