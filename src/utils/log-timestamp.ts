/**
 * 给 console.* 输出统一加本地时间前缀，便于 docker logs 排查时对齐时间线。
 *
 * 背景：主服务（app / queue-worker）大量业务日志直接用 console.log 打印，
 * 无时间戳；winston logger（src/utils/logger.ts）自带时间戳。
 * 因此补丁会跳过已带时间戳的行（如 "2026-11-25 09:11:19:1119 ..."），
 * 避免双重前缀。
 *
 * 使用：模块加载即自动生效（幂等，重复加载不会嵌套包装）。
 * - app 容器：src/instrumentation.ts 的 register() 中动态引入
 * - worker 容器：src/worker/index.ts 的首个 import
 */

const TIMED_PREFIX = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/;

function localTimestamp(): string {
    const d = new Date();
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return (
        `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
        `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
    );
}

let patched = false;

export function patchConsoleTimestamp(): void {
    if (patched) {
        return;
    }
    patched = true;

    const methods: Array<'log' | 'info' | 'warn' | 'error' | 'debug'> = [
        'log', 'info', 'warn', 'error', 'debug',
    ];

    for (const method of methods) {
        const original = console[method].bind(console);
        (console as unknown as Record<string, (...args: unknown[]) => void>)[method] = (
            ...args: unknown[]
        ) => {
            const first = args[0];
            // winston 等已带时间戳的行直接透传，避免双重前缀
            if (typeof first === 'string' && TIMED_PREFIX.test(first)) {
                original(...args);
                return;
            }
            original(`[${localTimestamp()}]`, ...args);
        };
    }
}

// 模块加载即生效（仅首次，幂等）
patchConsoleTimestamp();
