/**
 * Next.js 服务启动钩子。
 * 在 nodejs runtime 启动早期为 console.* 统一加上时间前缀，
 * 使 app 容器内所有业务日志（Server Actions / SSE / API 路由等）
 * 在 docker logs 中都带有时间戳。
 */
export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        await import('@/utils/log-timestamp');
    }
}
