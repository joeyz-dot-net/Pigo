/**
 * 导航栏管理模块 - 处理导航栏的多语言支持
 */

import { i18n } from './i18n.js';

export const navManager = {
    /**
     * 初始化导航栏
     */
    init() {
        console.log('[导航] 初始化导航栏管理器');
        this.updateNavLabels();
        
        // 注册语言改变监听器
        i18n.onLanguageChange(() => {
            this.updateNavLabels();
        });
    },

    /**
     * 更新导航栏文本标签
     * 注意：导航栏按钮已移除文字标签，仅显示图标
     */
    updateNavLabels() {
        // 导航栏不再显示文字标签，仅保留图标
        // 此方法保留供将来扩展使用
        console.log('[导航] 导航栏已初始化（仅显示图标）');
    },

    /**
     * 当语言改变时更新导航栏
     */
    onLanguageChanged() {
        this.updateNavLabels();
    }
};
