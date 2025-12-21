/**
 * 用户设置管理模块
 * 注意：用户设置存储在浏览器 localStorage 中，不依赖服务器存储
 */

import { Toast } from './ui.js';
import { themeManager } from './themeManager.js';
import { i18n } from './i18n.js';

export const settingsManager = {
    // 默认设置
    DEFAULT_SETTINGS: {
        'theme': 'dark',
        'auto_stream': false,
        'stream_volume': '50',
        'language': 'auto'
    },
    
    // 用于存储 player 实例引用
    player: null,
    schema: {},
    
    /**
     * 获取设置对象（从 localStorage）
     */
    get settings() {
        return this.loadSettingsFromStorage();
    },
    
    /**
     * 设置 player 实例
     */
    setPlayer(playerInstance) {
        this.player = playerInstance;
        console.log('[设置] player 实例已注册');
    },
    
    /**
     * 初始化设置管理器
     */
    async init() {
        try {
            console.log('[设置] 初始化设置管理器（使用浏览器 localStorage）...');
            
            // 从 localStorage 加载设置
            this.loadSettingsFromStorage();
            
            // 更新 UI 表单
            this.updateUI();
            
            // 加载 schema
            await this.loadSchema();
            
            // 应用主题
            this.applyTheme();
            
            // 应用语言
            this.applyLanguage();
            
            // 更新UI并绑定事件
            this.updateUI();
            
            console.log('✓ 设置管理器已初始化（localStorage）');
        } catch (error) {
            console.error('[设置] 初始化失败:', error);
        }
    },
    
    /**
     * 从 localStorage 加载设置
     */
    loadSettingsFromStorage() {
        const stored = localStorage.getItem('musicPlayerSettings');
        
        if (stored) {
            try {
                const settings = JSON.parse(stored);
                console.log('[设置] 从 localStorage 加载设置:', settings);
                return settings;
            } catch (e) {
                console.error('[设置] 解析 localStorage 失败:', e);
                return this.DEFAULT_SETTINGS;
            }
        }
        
        console.log('[设置] localStorage 中无设置，使用默认值');
        return this.DEFAULT_SETTINGS;
    },
    
    /**
     * 保存设置到 localStorage
     */
    saveSettingsToStorage(settings) {
        try {
            localStorage.setItem('musicPlayerSettings', JSON.stringify(settings));
            console.log('[设置] 已保存到 localStorage:', settings);
            return true;
        } catch (e) {
            console.error('[设置] 保存到 localStorage 失败:', e);
            return false;
        }
    },
    
    /**
     * 获取单个设置值
     */
    getSettings(key) {
        const settings = this.loadSettingsFromStorage();
        return settings[key] !== undefined ? settings[key] : this.DEFAULT_SETTINGS[key];
    },
    
    /**
     * 设置单个值
     */
    setSetting(key, value) {
        const settings = this.loadSettingsFromStorage();
        settings[key] = value;
        this.saveSettingsToStorage(settings);
        console.log(`[设置] ${key} = ${value}`);
        return true;
    },
    
    /**
     * 加载设置 schema
     */
    async loadSchema() {
        try {
            const response = await fetch('/settings/schema');
            const result = await response.json();
            
            if (result.status === 'OK') {
                this.schema = result.schema;
                console.log('[设置] Schema已加载');
            }
        } catch (error) {
            console.error('[设置] Schema加载失败:', error);
        }
    },
    
    /**
     * 更新UI - 将设置值同步到表单
     */
    updateUI() {
        const settings = this.loadSettingsFromStorage();
        
        // 主题
        const themeSelect = document.getElementById('themeSetting');
        if (themeSelect) {
            themeSelect.value = settings.theme || 'dark';
            themeSelect.addEventListener('change', (e) => {
                this.setSetting('theme', e.target.value);
                this.applyTheme(e.target.value);
            });
        }
        
        // 语言切换
        const langSelect = document.getElementById('languageSetting');
        if (langSelect) {
            langSelect.addEventListener('change', (e) => {
                this.setSetting('language', e.target.value);
                this.applyLanguage(e.target.value);
            });
        }
        
        // 关闭按钮
        const closeBtn = document.getElementById('settingsCloseBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closePanel());
        }
        
        // 点击遮罩关闭
        const mask = document.getElementById('settingsMask');
        if (mask) {
            mask.addEventListener('click', (e) => {
                if (e.target === mask) {
                    this.closePanel();
                }
            });
        }
    },
    
    /**
     * 应用主题
     */
    applyTheme(theme = null) {
        if (theme === null) {
            theme = this.getSettings('theme') || 'dark';
        }
        
        console.log(`[设置] 准备应用主题: ${theme}`);
        
        // 调用 themeManager 加载主题 CSS 和应用主题 class
        if (themeManager) {
            themeManager.loadTheme(theme, () => {
                console.log(`[设置] themeManager 已应用主题: ${theme}`);
            });
        }
        
        // 应用 data-theme 属性
        document.documentElement.setAttribute('data-theme', theme);
        
        // 统一的主题类名
        const themeClass = theme === 'light' ? 'theme-light' : 'theme-dark';
        
        // 应用 body 类名
        const body = document.body;
        body.classList.remove('theme-dark', 'theme-light');
        body.classList.add(themeClass);
        console.log(`[设置] body 类名已更新: ${body.className}`);
        
        // 应用歌单类名
        const playlistEl = document.getElementById('playlist');
        if (playlistEl) {
            playlistEl.classList.remove('theme-dark', 'theme-light', 'bright-theme', 'dark-theme');
            playlistEl.classList.add(themeClass);
            console.log(`[设置] playlist 类名已更新: ${playlistEl.className}`);
        } else {
            setTimeout(() => {
                const playlistEl = document.getElementById('playlist');
                if (playlistEl) {
                    playlistEl.classList.remove('theme-dark', 'theme-light', 'bright-theme', 'dark-theme');
                    playlistEl.classList.add(themeClass);
                    console.log(`[设置] playlist 类名已更新（重试）: ${playlistEl.className}`);
                }
            }, 100);
        }
    },
    
    /**
     * 应用语言设置
     */
    applyLanguage(language = null) {
        if (language === null) {
            language = this.getSettings('language') || i18n.currentLanguage || 'zh';
        }
        
        // 如果选择"自动"，则自动检测浏览器语言
        if (language === 'auto') {
            language = i18n.detectBrowserLanguage();
            console.log(`[设置] 自动选择语言: ${language}`);
        }
        
        console.log(`[设置] 准备应用语言: ${language}`);
        
        // 设置 i18n 语言
        i18n.setLanguage(language);
        
        // 更新设置页面的文本内容
        this.updateSettingsUIText(language);
    },
    
    /**
     * 更新设置页面的 UI 文本
     */
    updateSettingsUIText(language) {
        console.log(`[设置] 更新 UI 文本为语言: ${language}`);
        
        // 更新设置标题
        const title = document.querySelector('.settings-title');
        if (title) title.textContent = i18n.t('settings.title', language);
        
        // 更新外观设置章节
        const appearanceSection = document.querySelectorAll('.section-title')[0];
        if (appearanceSection) appearanceSection.textContent = i18n.t('settings.appearance', language);
        
        // 更新主题标签
        const themeLabel = document.querySelectorAll('.settings-label')[0];
        if (themeLabel) themeLabel.textContent = i18n.t('settings.theme', language);
        
        // 更新主题选项
        const themeSelect = document.getElementById('themeSetting');
        if (themeSelect) {
            const options = themeSelect.querySelectorAll('option');
            if (options[0]) options[0].textContent = i18n.t('settings.theme.dark', language);
            if (options[1]) options[1].textContent = i18n.t('settings.theme.light', language);
            if (options[2]) options[2].textContent = i18n.t('settings.theme.auto', language);
        }
        
        // 更新语言标签
        const langLabel = document.querySelectorAll('.settings-label')[1];
        if (langLabel) langLabel.textContent = i18n.t('settings.language', language);
        
        // 更新语言选项
        const langSelect = document.getElementById('languageSetting');
        if (langSelect) {
            const options = langSelect.querySelectorAll('option');
            if (options[0]) options[0].textContent = i18n.t('settings.language.auto', language);
            if (options[1]) options[1].textContent = i18n.t('settings.language.zh', language);
            if (options[2]) options[2].textContent = i18n.t('settings.language.en', language);
        }
        
        // 更新推流设置章节
        const streamingSection = document.querySelectorAll('.section-title')[1];
        if (streamingSection) streamingSection.textContent = i18n.t('settings.streaming', language);
        
        // 更新自动推流标签
        const autoStreamLabel = document.querySelectorAll('.settings-label')[2];
        if (autoStreamLabel) autoStreamLabel.textContent = i18n.t('settings.autoStream', language);
        
        // 更新自动推流文本
        const toggleTexts = document.querySelectorAll('.toggle-text');
        toggleTexts.forEach((el, index) => {
            const toggleOn = el.querySelector('.toggle-on');
            const toggleOff = el.querySelector('.toggle-off');
            if (toggleOn) toggleOn.textContent = i18n.t('settings.autoStream.enable', language);
            if (toggleOff) toggleOff.textContent = i18n.t('settings.autoStream.disable', language);
        });
        
        // 更新推流音量标签
        const volumeLabel = document.querySelectorAll('.settings-label')[3];
        if (volumeLabel) volumeLabel.textContent = i18n.t('settings.streamVolume', language);
    },
    
    /**
     * 保存设置
     */
    async saveSettings() {
        try {
            // 显示保存中的提示
            this.showNotification(i18n.t('settings.saving'), 'info');
            
            // 收集表单数据
            const updates = {
                theme: document.getElementById('themeSetting')?.value || 'dark',
                language: document.getElementById('languageSetting')?.value || 'auto'
            };
            
            // 发送到服务器
            const response = await fetch('/settings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updates)
            });
            
            const result = await response.json();
            
            if (result.status === 'OK') {
                this.settings = result.data;
                this.applyTheme(updates.theme);
                
                // 应用语言设置
                this.applyLanguage(updates.language);
                
                // 显示保存成功提示
                this.showNotification(i18n.t('settings.saveSuccess'), 'success');
                console.log('[设置] 已保存');
                
                // 延迟 1.5 秒后关闭设置面板
                console.log('[设置] 将在 1.5 秒后关闭设置面板...');
                setTimeout(() => {
                    this.closePanel();
                }, 1500);
            } else {
                this.showNotification(i18n.t('settings.saveFailed') + ': ' + result.error, 'error');
                console.error('[设置] 保存失败:', result.error);
            }
        } catch (error) {
            console.error('[设置] 保存失败:', error);
            this.showNotification(i18n.t('settings.saveFailed') + ': ' + error.message, 'error');
        }
    },
    
    /**
     * 重置设置
     */
    async resetSettings() {
        console.log('[DEBUG] resetSettings() 被调用了');
        if (!confirm(i18n.t('settings.resetConfirm'))) {
            console.log('[DEBUG] 用户取消了重置');
            return;
        }
        
        try {
            console.log('[DEBUG] 开始重置为默认值...');
            
            // 默认设置值
            const defaults = {
                theme: 'dark',
                language: 'zh'
            };
            
            // 设置表单元素为默认值
            const themeEl = document.getElementById('themeSetting');
            const languageEl = document.getElementById('languageSetting');
            
            if (themeEl) themeEl.value = defaults.theme;
            if (languageEl) languageEl.value = defaults.language;
            
            console.log('[DEBUG] 表单元素已重置为默认值');
            
            // 显示重置中的提示
            this.showNotification(i18n.t('settings.resetting'), 'info');
            
            // 保存到服务器
            const updates = {
                theme: defaults.theme,
                language: defaults.language,
                auto_stream: defaults.auto_stream,
                stream_volume: defaults.stream_volume
            };
            
            console.log('[DEBUG] 发送保存请求...');
            const response = await fetch('/settings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updates)
            });
            
            const result = await response.json();
            console.log('[DEBUG] 保存结果:', result);
            
            if (result.status === 'OK') {
                this.settings = result.data;
                this.applyTheme(defaults.theme);
                this.applyLanguage(defaults.language);
                
                // 显示重置成功提示
                this.showNotification(i18n.t('settings.resetSuccess'), 'success');
                console.log('[设置] 已重置');
                
                // 不关闭面板，不刷新页面，用户可继续调整设置
            } else {
                this.showNotification(i18n.t('settings.resetFailed') + ': ' + result.error, 'error');
                console.error('[设置] 重置失败:', result.error);
            }
        } catch (error) {
            console.error('[设置] 重置失败:', error);
            this.showNotification(i18n.t('settings.resetFailed') + ': ' + error.message, 'error');
        }
    },
    
    /**
     * 显示设置面板
     */
    openPanel() {
        const panel = document.getElementById('settingsPanel');
        if (panel) {
            panel.style.display = 'block';
            document.body.style.overflow = 'hidden';
            console.log('[设置] 打开设置面板');
        }
    },
    
    /**
     * 关闭设置面板
     */
    closePanel() {
        const panel = document.getElementById('settingsPanel');
        if (panel) {
            panel.style.display = 'none';
            document.body.style.overflow = '';
            console.log('[设置] 关闭设置面板');
        }
    },
    
    /**
     * 获取单个设置
     */
    get(key, defaultValue = null) {
        return this.settings[key] !== undefined ? this.settings[key] : defaultValue;
    },
    
    /**
     * 设置单个值
     */
    async set(key, value) {
        try {
            const response = await fetch(`/settings/${key}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ value })
            });
            
            const result = await response.json();
            
            if (result.status === 'OK') {
                this.settings[key] = value;
                console.log(`[设置] ${key} = ${value}`);
                return true;
            }
            return false;
        } catch (error) {
            console.error(`[设置] 设置 ${key} 失败:`, error);
            return false;
        }
    },
    
    /**
     * 显示通知 - 使用 Toast 保持和播放页面风格一致
     */
    showNotification(message, type = 'success') {
        // 使用统一的 Toast 组件
        if (type === 'error') {
            Toast.error(message, 3000);
        } else if (type === 'success') {
            Toast.success(message, 3000);
        } else {
            Toast.info(message, 3000);
        }
    }
};
