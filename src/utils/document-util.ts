import { IChunk } from "@/types/chunk";
// 仅类型引用：确保 react-pdf-highlighter（内含 pdf.js，体积巨大）
// 永远不会因此被打进客户端 bundle。
import type { IHighlight } from "react-pdf-highlighter";

export function getExtension(filename: string): string {
    const parts = filename.split('.');
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

export function getUnSupportedFilesCount(message: string): number {
    try {
        const regex = /(\d+)\s+files?\s+not\s+supported/i;
        const match = regex.exec(message);
        return match ? parseInt(match[1], 10) : 0;
    } catch (error) {
        return 0;
    }
}

export function buildChunkHighlights(chunk: IChunk, size: { width: number, height: number }): IHighlight[] {
    return [];
}
