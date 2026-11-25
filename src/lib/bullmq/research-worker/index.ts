import { ResearchJobPayload } from "@/actions/research";
import { createWorker } from '../queue-manager';
import { TaskType } from '../types';
import { Job } from 'bullmq';
import logger from '@/utils/logger';
import { processResearchTask } from '@/lib/deep-research';
import { publishError, publishComplete } from '@/lib/deep-research/tracker-store';

/**
 * Research Worker 处理器
 * 从队列中获取任务并调用实际的研究处理函数
 */
async function processResearchJob(job: Job<ResearchJobPayload>): Promise<void> {
    const { taskId, userId, question, tokenBudget } = job.data;
    logger.info(`[Research Worker] 开始处理任务 ${taskId} (用户 ${userId}): "${question}"`);

    try {
        // 调用实际的研究处理函数
        await processResearchTask(taskId, userId, question, tokenBudget);

        logger.info(`[Research Worker] 任务 ${taskId} 处理完成`);
    } catch (error) {
        logger.error(`[Research Worker] 任务 ${taskId} 处理失败:`, error);

        // 关键修复：把失败事件推送到 Redis（SSE 会转发给前端），
        // 否则前端永远停留在"正在深度思考中"无法感知任务已崩溃。
        try {
            const errorMessage = error instanceof Error ? error.message : String(error);
            await publishError(taskId, `研究任务执行失败: ${errorMessage}`);
            await publishComplete(taskId, 'Task failed');
        } catch (publishErr) {
            logger.error(`[Research Worker] 推送任务失败事件到 Redis 时出错:`, publishErr);
        }

        throw error;
    }
}

// 创建并启动 Research Worker
const researchWorker = createWorker<ResearchJobPayload, void>(
    TaskType.DEEP_RESEARCH,
    processResearchJob
);

logger.info('[Research Worker] Research Worker 已启动');

export default researchWorker; 