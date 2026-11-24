'use client';

import rehypeKatex from 'rehype-katex';
import {
    MarkdownImpl as BaseMarkdownImpl,
    markdownCodeComponent,
} from './markdown-impl';
import 'katex/dist/katex.min.css';

interface MarkdownImplMathProps {
    content: string;
    className?: string;
    components?: any;
}

/**
 * 带数学公式支持的 Markdown 渲染实现（react-markdown 管线 + KaTeX）。
 * 仅在内容中检测到数学定界符时才通过 markdown.tsx 动态加载，
 * KaTeX（约 262KB JS + CSS）不会进入普通消息的加载路径。
 */
export function MarkdownImplMath({ content, className, components }: MarkdownImplMathProps) {
    return (
        <BaseMarkdownImpl
            content={content}
            className={className}
            components={{ code: markdownCodeComponent, ...components }}
            rehypePlugins={[rehypeKatex]}
        />
    );
}
