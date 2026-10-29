import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children }) => <span className="link-text">{children}</span> }}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
