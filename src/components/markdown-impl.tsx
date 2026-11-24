'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils';

// 懒加载 Mermaid：mermaid 库体积很大（约 1.5MB），
// 仅在消息中真正出现 mermaid 代码块时才按需加载，避免拖慢首屏。
const Mermaid = dynamic(
    () => import('./mermaid').then((mod) => mod.Mermaid),
    {
        ssr: false,
        loading: () => (
            <div className="my-4 p-4 text-sm text-muted-foreground rounded-md border border-dashed">
                正在加载流程图…
            </div>
        ),
    }
);

/**
 * 共享的代码块渲染组件：检测 mermaid 语言并懒加载渲染，其余走默认渲染。
 */
export function markdownCodeComponent(
    { className: codeClassName, children, ...props }: any
) {
    // 仅代码块会携带 language-xxx 的 className，行内代码不受影响
    if (/language-mermaid/.test(codeClassName || '')) {
        const chart = String(children).replace(/\n$/, '');
        return <Mermaid chart={chart} />;
    }

    return (
        <code className={codeClassName} {...props}>
            {children}
        </code>
    );
}

export const markdownProseClass = cn(
    "prose prose-sm max-w-none dark:prose-invert",
    // 表格边框样式
    "[&_table]:border [&_table]:border-border [&_table]:border-solid [&_table]:border-[1px]",
    "[&_th]:border [&_th]:border-border [&_th]:border-solid [&_th]:border-[1px]",
    "[&_td]:border [&_td]:border-border [&_td]:border-solid [&_td]:border-[1px]",
    "[&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2",
    "[&_table]:border-collapse [&_th]:bg-muted/50"
);

interface MarkdownImplProps {
    content: string;
    className?: string;
    components?: React.ComponentProps<typeof ReactMarkdown>['components'];
    /** 额外的 rehype 插件（如 KaTeX），由调用方注入 */
    rehypePlugins?: any[];
}

/**
 * 基础 Markdown 渲染实现（不含 KaTeX）。
 * 通过 markdown.tsx 动态加载，避免 react-markdown 管线（约 345KB）阻塞首屏。
 */
export function MarkdownImpl({ content, className, components, rehypePlugins }: MarkdownImplProps) {
    return (
        <div className={cn(markdownProseClass, className)}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={rehypePlugins ? [rehypeRaw, ...rehypePlugins] : [rehypeRaw]}
                components={{ code: markdownCodeComponent, ...components }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}
