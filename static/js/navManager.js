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
     */
    updateNavLabels() {
        const navItems = document.querySelectorAll('.nav-item .nav-label');
        const navMappings = {
            0: 'nav.queue',      // 队列
            1: 'nav.local',      // 本地
            2: 'nav.ranking',    // 排行
            3: 'nav.search',     // 搜索
            4: 'nav.stream',     // 推流
            5: 'nav.settings',   // 设置
            6: 'nav.debug'       // 调试
        };

        navItems.forEach((label, index) => {
            const key = navMappings[index];
            if (key) {
                label.textContent = i18n.t(key);
            }
        });

        console.log('[导航] 导航栏标签已更新');
    },

    /**
     * 当语言改变时更新导航栏
     */
    onLanguageChanged() {
        this.updateNavLabels();
    }
};
