import React from 'react';
import ReactMarkdown from 'react-markdown';

interface FormattedMarkdownProps {
  content?: string | null;
  variant?: 'light' | 'dark';
  className?: string;
}

export function FormattedMarkdown({ content, variant = 'light', className = '' }: FormattedMarkdownProps) {
  if (!content) return null;

  const isDark = variant === 'dark';

  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown
        components={{
          p: ({ children }) => (
            <p className={`mb-2 last:mb-0 leading-relaxed ${isDark ? 'text-white/90' : 'text-stone-700'}`}>
              {children}
            </p>
          ),
          strong: ({ children }) => (
            <strong className={`font-semibold ${isDark ? 'text-white' : 'text-stone-900'}`}>
              {children}
            </strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => (
            <ul className={`list-disc list-inside space-y-1.5 my-2 ${isDark ? 'text-white/90' : 'text-stone-700'}`}>
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className={`list-decimal list-inside space-y-1.5 my-2 ${isDark ? 'text-white/90' : 'text-stone-700'}`}>
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-relaxed inline-block w-full">{children}</li>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={`underline font-medium transition-colors ${
                isDark ? 'text-blue-400 hover:text-blue-300' : 'text-[#0b5a4b] hover:text-emerald-800'
              }`}
            >
              {children}
            </a>
          ),
          code: ({ children }) => (
            <code
              className={`font-mono text-xs px-1.5 py-0.5 rounded ${
                isDark
                  ? 'bg-white/10 text-white/90 border border-white/10'
                  : 'bg-stone-100 text-stone-800 border border-stone-200'
              }`}
            >
              {children}
            </code>
          ),
          blockquote: ({ children }) => (
            <blockquote
              className={`border-l-4 pl-3 italic my-2 ${
                isDark ? 'border-blue-400 text-white/70' : 'border-[#0b5a4b] text-stone-600'
              }`}
            >
              {children}
            </blockquote>
          ),
          h1: ({ children }) => (
            <h1 className={`text-xl font-bold my-2 ${isDark ? 'text-white' : 'text-stone-900'}`}>
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className={`text-lg font-bold my-2 ${isDark ? 'text-white' : 'text-stone-900'}`}>
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className={`text-base font-bold my-1 ${isDark ? 'text-white' : 'text-stone-900'}`}>
              {children}
            </h3>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
