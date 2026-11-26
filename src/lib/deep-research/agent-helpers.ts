import { CoreMessage } from 'ai';
import { ZodObject } from 'zod';
import {
    StepAction, AnswerAction, ReflectAction, SearchAction, VisitAction,
    KnowledgeItem, TrackerContext, SearchSnippet, BoostedSearchSnippet, WebContent,
    Reference, EvaluationResponse
} from './types';
import {
    normalizeUrl, getLastModified, rankURLs, filterURLs, fixBadURLMdLinks
} from "./utils/url-tools";
import {
    buildMdFromAnswer, convertHtmlTablesToMd, fixCodeBlockIndentation,
    repairMarkdownFinal, repairMarkdownFootnotesOuter, repairIndexedString
} from "./utils/text-tools";
import { repairUnknownChars } from "./tools/broken-ch-fixer";
import { buildReferences } from "./tools/build-ref";
import { evaluateQuestion } from './tools/evaluator';
import { validateAnswer } from './tools/validator';
import { getPrompt } from './utils/prompt';
import { composeMsgs } from './utils/message';
import { ObjectGeneratorSafe } from "./utils/safe-generator";
import { Schemas } from "./utils/schemas";
import { ResearchAgent } from './agent';


function coerceToPlainText(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (value === null || value === undefined) {
        return '';
    }
    if (Array.isArray(value)) {
        return value.map(item => coerceToPlainText(item)).join('');
    }
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const orderedKeys = Object.keys(record).sort((a, b) => {
            const aNum = Number(a);
            const bNum = Number(b);
            const aIsNum = !Number.isNaN(aNum);
            const bIsNum = !Number.isNaN(bNum);
            if (aIsNum && bIsNum) {
                return aNum - bNum;
            }
            if (aIsNum) return -1;
            if (bIsNum) return 1;
            return a.localeCompare(b);
        });
        return orderedKeys.map(key => coerceToPlainText(record[key])).join('');
    }
    return String(value);
}

// Updated signature to accept ResearchAgent instance (or necessary properties)
export async function updateReferencesHelper(thisAgent: ResearchAgent, thisStep: AnswerAction) {
    const allURLs = (thisAgent as any).allURLs as Record<string, SearchSnippet>; // Access private member via cast
    thisStep.references = thisStep.references
        ?.filter(ref => ref?.url)
        .map(ref => {
            const normalizedUrl = normalizeUrl(ref.url);
            if (!normalizedUrl) return null;

            return {
                ...ref,
                exactQuote: (ref?.exactQuote ||
                    allURLs[normalizedUrl]?.description ||
                    allURLs[normalizedUrl]?.title || '')
                    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
                    .replace(/\s+/g, ' '),
                title: allURLs[normalizedUrl]?.title || '',
                url: normalizedUrl,
                dateTime: ref?.dateTime || allURLs[normalizedUrl]?.date || '',
            };
        })
        .filter(Boolean) as Reference[];

    await Promise.all((thisStep.references || []).filter(ref => !ref.dateTime)
        .map(async ref => {
            try {
                ref.dateTime = await getLastModified(ref.url) || '';
            } catch (error) {
                console.warn(`Failed to fetch last modified date for ${ref.url}:`, error);
                ref.dateTime = ref.dateTime || '';
            }
        }));

    console.log('Updated References (Helper):', thisStep.references);
}

// Updated signature to accept ResearchAgent instance (or necessary properties)
export function initializeEvaluationMetricsHelper(thisAgent: ResearchAgent, currentQuestion: string): void {
    const totalStep = (thisAgent as any).totalStep as number;
    const question = (thisAgent as any).question as string;
    const evaluationMetrics = (thisAgent as any).evaluationMetrics as Record<string, any[]>;
    const options = (thisAgent as any).options as any; // Assuming ResearchAgentOptions type is available
    const context = (thisAgent as any).context as TrackerContext;
    const SchemaGen = (thisAgent as any).SchemaGen as Schemas;

    if (currentQuestion.trim() === question && totalStep === 1) {
        evaluateQuestion(currentQuestion, context, SchemaGen)
            .then(evalTypes => {
                evaluationMetrics[currentQuestion] = evalTypes.map(e => ({
                    type: e,
                    numEvalsRequired: options.maxBadAttempts
                }));
                evaluationMetrics[currentQuestion].push({ type: 'strict', numEvalsRequired: options.maxBadAttempts });
            })
            .catch(err => console.error(`Failed to evaluate question ${currentQuestion}:`, err));
    } else if (currentQuestion.trim() !== question && !evaluationMetrics[currentQuestion]) {
        evaluationMetrics[currentQuestion] = [];
    }
}

// Updated signature to accept ResearchAgent instance (or necessary properties)
export async function determineNextActionHelper(thisAgent: ResearchAgent, currentQuestion: string): Promise<StepAction | null> {
    const diaryContext = (thisAgent as any).diaryContext as string[];
    const allQuestions = (thisAgent as any).allQuestions as string[];
    const allKeywords = (thisAgent as any).allKeywords as string[];
    const allowReflect = (thisAgent as any).allowReflect as boolean;
    const allowAnswer = (thisAgent as any).allowAnswer as boolean;
    const allowRead = (thisAgent as any).allowRead as boolean;
    const allowSearch = (thisAgent as any).allowSearch as boolean;
    const allKnowledge = (thisAgent as any).allKnowledge as KnowledgeItem[];
    const weightedURLs = (thisAgent as any).weightedURLs as BoostedSearchSnippet[];
    const question = (thisAgent as any).question as string;
    const finalAnswerPIP = (thisAgent as any).finalAnswerPIP as string[];
    const SchemaGen = (thisAgent as any).SchemaGen as Schemas;
    const messages = (thisAgent as any).messages as CoreMessage[];
    const generator = (thisAgent as any).generator as ObjectGeneratorSafe;
    const msgWithKnowledge = (thisAgent as any).msgWithKnowledge as CoreMessage[]; // This needs assignment

    const { system, urlList } = getPrompt(
        diaryContext,
        allQuestions,
        allKeywords,
        allowReflect,
        allowAnswer,
        allowRead,
        allowSearch,
        allKnowledge,
        weightedURLs,
        false, // Not final step
    );
    const schema = SchemaGen.getAgentSchema(allowReflect, allowRead, allowAnswer, allowSearch, currentQuestion);
    // Assign msgWithKnowledge before use
    (thisAgent as any).msgWithKnowledge = composeMsgs(messages, allKnowledge, currentQuestion, currentQuestion === question ? finalAnswerPIP : undefined);

    try {
        const result = await generator.generateObject({
            model: 'agent', // Use appropriate model alias
            schema,
            system,
            messages: (thisAgent as any).msgWithKnowledge, // Use the assigned value
            numRetries: 2,
        });

        // 验证返回的结果
        if (!result || !result.object) {
            console.error("LLM returned empty result");
            console.error("Messages context:", {
                messageCount: (thisAgent as any).msgWithKnowledge?.length,
                knowledgeCount: allKnowledge.length,
                hasWeightedURLs: weightedURLs.length > 0
            });
            return null;
        }

        const actionType = result.object.action;

        // 严格验证 action 字段
        if (!actionType || typeof actionType !== 'string') {
            console.error("Invalid action type returned by LLM:", {
                action: actionType,
                fullObject: result.object
            });
            return null;
        }

        // 验证 action 类型是否有效
        const validActions = ['search', 'visit', 'answer', 'reflect'];
        if (!validActions.includes(actionType)) {
            console.error(`Unknown action type: ${actionType}. Valid actions: ${validActions.join(', ')}`);
            return null;
        }

        // 模型偶尔把长文本（尤其 answer）输出成 {"0":"a","1":"b",...} 字符索引对象。
        // 若在此处不重建，展开后 answer 字段会消失（变成一堆数字键），
        // 下游 mdAnswer/references/前端展示全部拿不到正文。
        const rawPayload = result.object[actionType];
        let actionPayload: Record<string, unknown> =
            rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
                ? rawPayload as Record<string, unknown>
                : {};
        if (actionType === 'answer') {
            const repairedPayload = repairIndexedString(actionPayload);
            if (typeof repairedPayload === 'string') {
                console.log(`[Generator] answer payload 为字符索引对象形态，已重建为字符串，长度: ${repairedPayload.length}`);
                actionPayload = { answer: repairedPayload };
            }
        }

        const repairedThink = repairIndexedString(result.object.think);

        const stepAction = {
            action: actionType,
            think: typeof repairedThink === 'string' ? repairedThink : '',
            ...actionPayload
        } as StepAction;

        // 摘要化：整篇答案可达数千键，直接打印会刷屏并拖慢日志 IO
        console.log('[Generator] Generated action:', {
            action: stepAction.action,
            think: typeof stepAction.think === 'string' ? `${stepAction.think.substring(0, 100)}...` : stepAction.think,
            answerLength: typeof (stepAction as any).answer === 'string' ? (stepAction as any).answer.length : undefined,
            keys: Object.keys(stepAction),
        });
        return stepAction;
    } catch (error) {
        console.error("Error generating next action:", error);
        console.error("Error details:", {
            errorName: (error as any)?.name,
            errorMessage: (error as any)?.message,
            allowedActions: {
                search: allowSearch,
                visit: allowRead,
                answer: allowAnswer,
                reflect: allowReflect
            },
            contextState: {
                knowledgeItems: allKnowledge.length,
                weightedURLs: weightedURLs.length,
                questions: allQuestions.length
            }
        });
        return null; // Return null on generation failure
    }
}

// Updated signature to accept ResearchAgent instance (or necessary properties)
export function updateContextHelper(thisAgent: ResearchAgent, stepData: any): void {
    // Push to the agent's context array
    thisAgent.allContext.push(stepData);
    const totalStep = (thisAgent as any).totalStep as number;
    console.log("Context updated (Helper) for step: ", stepData.totalStep || totalStep);
}

// Updated signature to accept ResearchAgent instance (or necessary properties)
interface GenerateAnswerOptions {
    currentQuestion?: string;
    beastMode?: boolean;
    isFinal?: boolean;
}

export async function generateFinalAnswerHelper(thisAgent: ResearchAgent, options: GenerateAnswerOptions = {}): Promise<AnswerAction> {
    const question = (options.currentQuestion?.trim() || (thisAgent as any).question || '').trim();
    const diaryContext = (thisAgent as any).diaryContext as string[];
    const allQuestions = (thisAgent as any).allQuestions as string[];
    const allKeywords = (thisAgent as any).allKeywords as string[];
    const allKnowledge = (thisAgent as any).allKnowledge as KnowledgeItem[];
    const SchemaGen = (thisAgent as any).SchemaGen as Schemas;
    const generator = (thisAgent as any).generator as ObjectGeneratorSafe;
    const messages = (thisAgent as any).messages as CoreMessage[];
    const finalAnswerPIP = (thisAgent as any).finalAnswerPIP as string[];
    const originalQuestion = (thisAgent as any).question as string;

    const { system } = getPrompt(
        diaryContext,
        allQuestions,
        allKeywords,
        false,   // allowReflect
        true,    // allowAnswer
        false,   // allowRead
        false,   // allowSearch
        allKnowledge,
        [],      // URLs already incorporated via knowledge
        options.beastMode ?? options.isFinal ?? true
    );

    const schema = SchemaGen.getAgentSchema(false, false, true, false, question);
    const composedMessages = composeMsgs(
        messages,
        allKnowledge,
        question,
        question === originalQuestion ? finalAnswerPIP : undefined
    );

    try {
        const result = await generator.generateObject({
            model: 'agent',
            schema,
            system,
            messages: composedMessages,
            numRetries: 2,
        });

        const rawAnswerPayload = result?.object?.answer?.answer;
        const rawThinkPayload = result?.object?.think;

        const normalizedAnswer = coerceToPlainText(rawAnswerPayload).trim();
        const normalizedThink = coerceToPlainText(rawThinkPayload).trim();

        // 验证答案有效性
        const validation = validateAnswer(normalizedAnswer);

        if (validation.valid) {
            console.log('✅ Answer validation passed');
            return {
                action: 'answer',
                answer: normalizedAnswer,
                references: [],
                think: normalizedThink,
                isFinal: options.isFinal ?? true
            };
        }

        // 答案无效，记录详细信息
        console.error('❌ Answer validation failed:', validation.reason);
        console.error('Raw answer payload:', rawAnswerPayload);
        console.error('Normalized answer:', normalizedAnswer);

        throw new Error(`Answer validation failed: ${validation.reason}`);
    } catch (error) {
        console.error('Error generating final answer (Helper):', error);

        const summaryItems = (allKnowledge || [])
            .slice(-5)
            .map((item, idx) => `${idx + 1}. ${item.answer}`)
            .join('\n');

        const fallbackAnswer = summaryItems
            ? `${question || originalQuestion} 的关键信息梳理：\n${summaryItems}`
            : `围绕“${question || originalQuestion}”的核心资料仍需扩充，可继续聚焦权威临床指南、GVHD 相关文献及近期病例综述以完善结论。`;

        return {
            action: 'answer',
            answer: fallbackAnswer,
            references: [],
            think: '基于现有知识自动生成摘要。',
            isFinal: options.isFinal ?? true
        };
    }
}

// Updated signature to accept ResearchAgent instance (or necessary properties)
export async function processFinalAnswerHelper(thisAgent: ResearchAgent, answerAction: AnswerAction): Promise<void> {
    console.log('Processing Final Answer (Helper)');
    // 收口点：无论 answerAction 从主循环还是 generateFinalAnswerHelper 来，
    // 都在这里把字符索引对象形态的 answer 重建为字符串，保证 mdAnswer 能正常生成。
    {
        const repaired = repairIndexedString(answerAction.answer);
        if (typeof repaired === 'string' && repaired !== answerAction.answer) {
            answerAction.answer = repaired;
            console.log('[Helper] answer 为字符索引对象形态，已重建为字符串，长度:', repaired.length);
        }
    }
    const trivialQuestion = (thisAgent as any).trivialQuestion as boolean;
    const allKnowledge = (thisAgent as any).allKnowledge as KnowledgeItem[];
    const context = (thisAgent as any).context as TrackerContext;
    const SchemaGen = (thisAgent as any).SchemaGen as Schemas;
    const allURLs = (thisAgent as any).allURLs as Record<string, SearchSnippet>;
    const allWebContents = (thisAgent as any).allWebContents as Record<string, WebContent>;
    const options = (thisAgent as any).options as any; // Assuming ResearchAgentOptions type

    if (trivialQuestion) {
        // 防御：mdAnswer 后处理链（markdown 修复/表格转换）依赖 LLM 输出的完整性，
        // 任一环节抛错不应导致整个研究任务失败，回退为原始 answer。
        try {
            answerAction.mdAnswer = answerAction.mdAnswer || convertHtmlTablesToMd(
                fixCodeBlockIndentation(
                    buildMdFromAnswer(answerAction))
            );
        } catch (e) {
            console.error('Error building mdAnswer for trivial question, falling back to raw answer:', e);
            // answer 若仍是索引对象形态（{"0":"c",...}），先重建为字符串再兜底
            const rawAnswer = repairIndexedString(answerAction.answer);
            answerAction.mdAnswer = typeof rawAnswer === 'string' ? rawAnswer : '';
        }
        return;
    }

    answerAction.answer = answerAction.answer || "I couldn't find a definitive answer, but here's what I gathered.";

    try {
        const repairedAnswer = repairMarkdownFinal(
            convertHtmlTablesToMd(
                fixBadURLMdLinks(
                    fixCodeBlockIndentation(
                        repairMarkdownFootnotesOuter(
                            await repairUnknownChars(
                                answerAction.answer,
                                context,
                                thisAgent.userId)) // 传递 userId
                    ),
                    allURLs)));
        answerAction.answer = repairedAnswer;
    } catch (repairError) {
        console.error("Error repairing final answer markdown:", repairError);
    }

    try {
        const { answer, references } = await buildReferences(
            answerAction.answer,
            allWebContents,
            context,
            SchemaGen,
            80, // Threshold?
            options.maxRef,
            options.minRelScore
        );
        answerAction.answer = answer;
        answerAction.references = references;
        // Call the helper for updating references, passing the agent instance
        await updateReferencesHelper(thisAgent, answerAction);
        answerAction.mdAnswer = repairMarkdownFootnotesOuter(buildMdFromAnswer(answerAction));
    } catch (refError) {
        console.error("Error building or updating references:", refError);
        answerAction.references = answerAction.references || [];
        try {
            answerAction.mdAnswer = repairMarkdownFootnotesOuter(buildMdFromAnswer(answerAction));
        } catch (mdBuildError) {
            console.error("Error building final MdAnswer after reference failure:", mdBuildError);
            answerAction.mdAnswer = answerAction.answer;
        }
    }
    // 摘要化：answer/mdAnswer 可达数百 KB，直接打印整个对象会刷屏
    console.log('[Helper] Final Processed Answer summary:', {
        action: answerAction.action,
        answerLength: typeof answerAction.answer === 'string' ? answerAction.answer.length : typeof answerAction.answer,
        mdAnswerLength: typeof answerAction.mdAnswer === 'string' ? answerAction.mdAnswer.length : typeof answerAction.mdAnswer,
        referenceCount: Array.isArray(answerAction.references) ? answerAction.references.length : undefined,
        isFinal: answerAction.isFinal,
    })
}

// Updated signature to accept ResearchAgent instance (or necessary properties)
export async function rankURLsHelper(thisAgent: ResearchAgent): Promise<BoostedSearchSnippet[]> {
    const allURLs = (thisAgent as any).allURLs as Record<string, SearchSnippet>;
    const visitedURLs = (thisAgent as any).visitedURLs as string[];
    const options = (thisAgent as any).options as any; // Assuming ResearchAgentOptions type
    const gaps = (thisAgent as any).gaps as string[];
    const totalStep = (thisAgent as any).totalStep as number;
    const question = (thisAgent as any).question as string;
    const context = (thisAgent as any).context as TrackerContext;

    return await rankURLs(
        filterURLs(allURLs, visitedURLs, options.badHostnames, options.onlyHostnames),
        {
            question: gaps[totalStep % gaps.length] || question,
            boostHostnames: options.boostHostnames
        }, context);
}
