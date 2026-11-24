'use client';

import dynamic from 'next/dynamic';
import type ReactMarkdown from 'react-markdown';

// 懒加载真正的 Markdown 渲染管线。
// react-markdown + remark/rehype（约 345KB）不再进入首屏同步加载路径：
// 首帧只输出轻量骨架，管线 chunk（有不可变缓存）就绪后即渲染。
const MarkdownImpl = dynamic(
    () => import('./markdown-impl').then((mod) => mod.MarkdownImpl),
    { ssr: false, loading: MarkdownLoading }
);

// 带数学公式支持的实现：叠加 KaTeX（约 262KB JS + CSS），
// 仅在内容包含数学定界符时才加载，绝大多数普通消息完全不会请求该 chunk。
const MarkdownImplMath = dynamic(
    () => import('./markdown-impl-math').then((mod) => mod.MarkdownImplMath),
    { ssr: false, loading: MarkdownLoading }
);

// 数学定界符检测：$$...$$、\(...\)、\[...\] 或要求紧贴内容的 $...$
const MATH_PATTERN = /\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|\$[^\s$][^$\n]*?\$/;

function hasMath(content: string): boolean {
    return MATH_PATTERN.test(content);
}

function MarkdownLoading() {
    return (
        <div
            className="my-2 h-4 w-2/3 animate-pulse rounded bg-muted/60"
            aria-hidden
        />
    );
}

interface MarkdownProps {
    content: string;
    className?: string;
    components?: React.ComponentProps<typeof ReactMarkdown>['components'];
}

/**
 * 通用的 Markdown 渲染组件（对外 API 保持不变）
 * 已包含表格、图片、数学公式和流程图支持，以及表格边框样式。
 *
 * 性能说明：
 * - 渲染管线（react-markdown/remark/rehype）按需懒加载，不再阻塞首屏；
 * - 含数学公式的内容才额外加载 KaTeX；
 * - mermaid 代码块才加载 mermaid（见 markdown-impl.tsx）。
 */
export function Markdown({ content, className, components }: MarkdownProps) {
    const Impl = hasMath(content) ? MarkdownImplMath : MarkdownImpl;
    return <Impl content={content} className={className} components={components} />;
}
