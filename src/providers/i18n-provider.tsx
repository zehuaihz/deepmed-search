'use client';

import React, { PropsWithChildren, useEffect, useState, useMemo } from 'react';
import i18next from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import zhTranslation from '@/i18n/locales/zh.json';

// 导入 LanguageContext
import { LanguageContext } from '@/contexts/language-context';

// 其余语言按需异步加载，避免 6 份翻译全量打进首屏共享 bundle。
const languageLoaders: Record<string, () => Promise<{ default: unknown }>> = {
    en: () => import('@/i18n/locales/en.json'),
    ja: () => import('@/i18n/locales/ja.json'),
    ar: () => import('@/i18n/locales/ar.json'),
    ko: () => import('@/i18n/locales/ko.json'),
    fr: () => import('@/i18n/locales/fr.json'),
};

// 同步打包的内置语言（zh 为 SSR / 首次客户端渲染的确定性初始语言，
// 保证服务端与客户端首次渲染一致，避免水合不匹配，也让 SSR HTML 不再是空白）
const SYNC_LANGUAGES = ['zh'];

// 浏览器端语言检测的 localStorage 缓存 key（与 i18next-browser-languagedetector 默认一致，
// 老用户的语言偏好可以无缝继承）
const LANG_CACHE_KEY = 'i18nextLng';

// --- i18next 初始化逻辑 ---
// 注意：这里不再使用 i18next-browser-languagedetector 做同步检测。
// 同步检测会让服务端（回退 zh）与客户端（检测出 en 等）首次渲染结果不一致，
// 之前的实现因此被迫在挂载前 return null，导致 SSR 输出整页空白，
// 部署后首屏必须等全部 JS 加载完才可见（这也是加载慢的主要原因之一）。
// 现在改为：服务端与客户端首次渲染统一以 zh 输出（SSR 内容立即可见），
// 挂载后在 useEffect 中异步检测并切换到用户实际语言。
i18next
    .use(initReactI18next) // 绑定 react-i18next
    .init({
        lng: 'zh', // 确定性初始语言，服务端/客户端首次渲染一致
        resources: {
            zh: { translation: zhTranslation },
        },
        fallbackLng: 'zh', // 未检测到语言时的回退语言
        interpolation: {
            escapeValue: false, // React 已内置防 XSS 功能
        },
        react: {
            // 避免语言资源异步加载时触发 Suspense 导致整树卸载
            useSuspense: false,
        },
    });

// 异步加载指定语言的资源包（已加载则跳过）并切换
const loadAndChangeLanguage = async (
    i18nInstance: typeof i18next,
    lang: string
): Promise<boolean> => {
    if (i18next.hasResourceBundle(lang, 'translation')) {
        await i18nInstance.changeLanguage(lang);
        return true;
    }
    const loader = languageLoaders[lang];
    if (!loader) return false;
    try {
        const mod = await loader();
        i18next.addResourceBundle(lang, 'translation', mod.default);
        await i18nInstance.changeLanguage(lang);
        return true;
    } catch (err) {
        console.error(`Failed to load language "${lang}":`, err);
        return false;
    }
};

// --- I18nProvider 组件 ---
export function I18nProvider({ children }: PropsWithChildren) {
    // 获取 i18next 实例 (useTranslation 必须在 i18next 初始化后调用)
    // 因此将其放在 Provider 组件内部
    const { i18n: i18nInstance } = useTranslation();
    // 从 i18next 实例初始化语言状态
    const [currentLanguage, setCurrentLanguage] = useState(() => i18nInstance.language || 'zh');
    const languages = useMemo(() => ['en', 'zh', 'ja', 'ar', 'ko', 'fr'], []);

    // 挂载后异步检测用户语言（localStorage 优先，其次浏览器语言），
    // 若与初始 zh 不同则加载资源包并切换。SSR 不受影响。
    useEffect(() => {
        let detected: string | null = null;
        try {
            detected = localStorage.getItem(LANG_CACHE_KEY);
        } catch {
            // localStorage 不可用时忽略
        }
        if (!detected && typeof navigator !== 'undefined') {
            detected = (navigator.language || '').split('-')[0].toLowerCase();
        }
        const supported = [...SYNC_LANGUAGES, ...Object.keys(languageLoaders)];
        if (detected && supported.includes(detected) && detected !== i18nInstance.language) {
            loadAndChangeLanguage(i18nInstance, detected).catch(() => {});
        }
    }, [i18nInstance]);

    // 监听 i18next 语言变化事件并更新 React 状态
    useEffect(() => {
        const handleLanguageChanged = (lng: string) => {
            // 与浏览器语言检测器保持相同的缓存行为，刷新后可继承偏好
            try {
                if (lng && typeof localStorage !== 'undefined') {
                    localStorage.setItem(LANG_CACHE_KEY, lng);
                }
            } catch {
                // 忽略 localStorage 写入失败
            }
            setCurrentLanguage(lng);
        };
        // 注册监听器
        i18nInstance.on('languageChanged', handleLanguageChanged);
        // 清理函数：组件卸载时移除监听器
        return () => {
            i18nInstance.off('languageChanged', handleLanguageChanged);
        };
    }, [i18nInstance]);

    const changeLanguage = (lang: string) => {
        if (!languages.includes(lang)) {
            console.warn(`Language "${lang}" is not supported.`);
            return;
        }
        loadAndChangeLanguage(i18nInstance, lang).catch(() => {});
    };

    // 优化 context value，避免不必要的重渲染
    const contextValue = useMemo(() => ({
        currentLanguage,
        changeLanguage,
        languages
    }), [currentLanguage, languages]); // changeLanguage 引用通常是稳定的

    // 重要：不再在挂载前 return null。
    // 之前的门控导致 SSR HTML 整页空白、首屏内容必须等待全部 JS 加载完成，
    // 是部署后加载慢的主要原因之一。现在服务端直接输出 zh 内容，
    // 客户端水合后按需切换到用户语言（zh 用户无任何闪烁）。
    return (
        <LanguageContext.Provider value={contextValue}>
            {children}
        </LanguageContext.Provider>
    );
}
