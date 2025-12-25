/**
 * 用户设置管理模块
 * 注意：用户设置存储在浏览器 localStorage 中，不依赖服务器存储
 */

import { Toast } from './ui.js';
import { themeManager } from './themeManager.js';
import { i18n } from './i18n.js';
import { api } from './api.js';

export const settingsManager = {
    // 默认设置
    DEFAULT_SETTINGS: {
        'theme': 'auto',
        'auto_stream': false,
        'stream_volume': '50',
        'language': 'auto',
        'stream_format': 'aac'  // 【新增】推流格式：mp3|aac|flac
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
            
            // 绑定事件
            this.bindEvents();
            
            // 检查服务器推流状态，更新UI
            await this.checkServerStreamingStatus();
            
            // 同步推流状态到 localStorage
            const autoStream = this.getSettings('auto_stream') === 'true' || this.getSettings('auto_stream') === true;
            localStorage.setItem('streamActive', autoStream ? 'true' : 'false');
            console.log(`[设置] 推流状态已同步: ${autoStream ? '启用' : '禁用'}`);
            
            console.log('✓ 设置管理器已初始化（localStorage）');
        } catch (error) {
            console.error('[设置] 初始化失败:', error);
        }
    },
    
    /**
     * 检查服务器推流状态，更新UI可用性
     */
    async checkServerStreamingStatus() {
        try {
            const response = await api.get('/config/streaming-enabled');
            const streamingEnabled = response.streaming_enabled;
            
            const autoStreamCheckbox = document.getElementById('autoStreamSetting');
            const streamSettingsSection = document.querySelector('[data-stream-settings]') || 
                                        document.querySelector('.stream-settings-section');
            
            if (streamingEnabled) {
                console.log('[推流] 服务器已启用推流功能');
                // 启用推流选项
                if (autoStreamCheckbox) {
                    autoStreamCheckbox.disabled = false;
                }
                if (streamSettingsSection) {
                    streamSettingsSection.classList.remove('disabled');
                    streamSettingsSection.title = '';
                }
                // 更新指示器为关闭状态（服务器启用，客户端未启用）
                this.updateStreamStatusIndicator('closed');
            } else {
                console.warn('[推流] 服务器已禁用推流功能，禁用客户端推流选项');
                // 禁用推流选项
                if (autoStreamCheckbox) {
                    autoStreamCheckbox.disabled = true;
                    autoStreamCheckbox.checked = false;
                }
                // 更新localStorage
                this.setSetting('auto_stream', false);
                localStorage.setItem('streamActive', 'false');
                
                if (streamSettingsSection) {
                    streamSettingsSection.classList.add('disabled');
                    streamSettingsSection.title = '服务器已禁用推流功能';
                }
                
                // 停止任何正在运行的推流
                this.stopStream();
                // 注意：不再显示 toast 提示，因为按钮已被隐藏，避免每次刷新都提示
                
                // 更新指示器为禁止状态
                this.updateStreamStatusIndicator('disabled');
                
                // 同时隐藏导航栏的推流按钮
                const streamNavBtn = document.getElementById('streamNavBtn');
                if (streamNavBtn) {
                    streamNavBtn.style.display = 'none';
                    console.log('[推流] 已隐藏导航栏推流按钮');
                }
            }
        } catch (error) {
            console.warn('[推流] 检查服务器推流状态失败:', error);
            // 发生错误时保守地禁用推流
            const autoStreamCheckbox = document.getElementById('autoStreamSetting');
            if (autoStreamCheckbox) {
                autoStreamCheckbox.disabled = true;
            }
            this.updateStreamStatusIndicator('disabled');
        }
    },
    
    /**
     * 更新推流状态指示器
     * @param {string} status - 状态：disabled(禁止), closed(关闭), buffering(缓冲), playing(播放)
     */
    updateStreamStatusIndicator(status) {
        const indicator = document.getElementById('streamStatusIndicator');
        const dot = document.querySelector('.stream-status-dot');
        const text = document.querySelector('.stream-status-text');
        
        if (!indicator || !dot || !text) return;
        
        // 移除所有状态类
        dot.classList.remove('stream-status-disabled', 'stream-status-closed', 'stream-status-buffering', 'stream-status-playing');
        
        // 添加新状态类和更新文本
        switch(status) {
            case 'disabled':
                dot.classList.add('stream-status-disabled');
                text.textContent = '点击启动推流';
                indicator.title = '推流状态：点击手动启动';
                indicator.style.display = 'none'; // 禁用时隐藏
                console.log('[推流指示器] 状态更新为：待启动（已隐藏）');
                break;
            case 'closed':
                dot.classList.add('stream-status-closed');
                text.textContent = '点击启动推流';
                indicator.title = '推流状态：已关闭，点击手动启动';
                indicator.style.display = 'flex'; // 关闭时显示，允许用户点击重新启动
                console.log('[推流指示器] 状态更新为：关闭（可点击启动）');
                break;
            case 'buffering':
                dot.classList.add('stream-status-buffering');
                text.textContent = '推流缓冲';
                indicator.title = '推流状态：正在缓冲';
                indicator.style.display = 'flex'; // 缓冲时显示
                console.log('[推流指示器] 状态更新为：缓冲');
                break;
            case 'playing':
                dot.classList.add('stream-status-playing');
                text.textContent = '推流播放';
                indicator.title = '推流状态：正在播放';
                indicator.style.display = 'flex'; // 播放时显示
                console.log('[推流指示器] 状态更新为：播放');
                break;
        }
        
        // 为指示器添加点击事件处理，允许用户手动恢复推流
        this.addIndicatorClickHandler(indicator, status);
    },
    
    /**
     * 为推流指示器添加点击事件处理
     * 当推流关闭或出错时，用户可以点击指示器来恢复推流
     */
    addIndicatorClickHandler(indicator, status) {
        // 移除之前的点击处理（如果有）
        indicator.onclick = null;
        
        // 在推流关闭或禁用时添加点击处理，允许用户手动启动
        if (status === 'closed' || status === 'disabled') {
            indicator.style.cursor = 'pointer';
            indicator.title = '点击启动推流';
            
            indicator.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                console.log('[推流指示器] 用户点击启动推流');
                
                // 检查服务器是否允许推流
                try {
                    const response = await api.get('/config/streaming-enabled');
                    if (!response.streaming_enabled) {
                        console.warn('[推流] 服务器已禁用推流功能');
                        this.showNotification('❌ 服务器已禁用推流功能', 'error');
                        return;
                    }
                } catch (error) {
                    console.error('[推流] 检查服务器推流状态失败:', error);
                    this.showNotification('❌ 无法检查推流状态', 'error');
                    return;
                }
                
                // 直接调用 player.startBrowserStream()（和调试面板一样）
                const streamFormat = localStorage.getItem('streamFormat') || 'mp3';
                console.log(`[推流指示器] 启动推流 (格式: ${streamFormat})`);
                
                // 获取 player 实例
                const player = window.app?.player || window.player;
                if (!player || typeof player.startBrowserStream !== 'function') {
                    console.error('[推流指示器] player 实例不存在或 startBrowserStream 方法未定义');
                    this.showNotification('❌ 播放器未就绪', 'error');
                    return;
                }
                
                try {
                    // 更新指示器为缓冲状态
                    this.updateStreamStatusIndicator('buffering');
                    
                    // 调用 player 的推流方法（和调试面板一样）
                    await player.startBrowserStream(streamFormat);
                    
                    // 等待一小段时间确保音频元素已设置
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    // 更新指示器为播放状态
                    this.updateStreamStatusIndicator('playing');
                    this.showNotification('✓ 推流已启动', 'success');
                    
                    console.log('[推流指示器] ✓ 推流启动成功');
                } catch (error) {
                    console.error('[推流指示器] 启动推流失败:', error);
                    this.updateStreamStatusIndicator('closed');
                    this.showNotification('❌ 启动失败: ' + error.message, 'error');
                }
            };
        } else {
            // 其他状态下不可点击
            indicator.style.cursor = 'default';
            indicator.onclick = null;
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
     * 应用推流音量到音频元素（仅改变浏览器音量，不调用后端）
     * @param {number} volume - 音量值 (0-100)
     */
    applyStreamVolume(volume) {
        const audioElement = document.getElementById('browserStreamAudio');
        if (!audioElement) {
            console.warn('[推流音量] 警告: 未找到 browserStreamAudio 元素');
            return false;
        }
        
        const volumeValue = Math.max(0, Math.min(100, parseInt(volume) || 50));
        const volumeDecimal = volumeValue / 100;
        audioElement.volume = volumeDecimal;
        console.log(`[推流音量] 已应用: ${volumeValue}% (HTML5 audio.volume = ${volumeDecimal.toFixed(2)})`);
        return true;
    },

    /**
     * 获取当前推流音量
     */
    getStreamVolume() {
        const volume = this.getSettings('stream_volume');
        return parseInt(volume) || 50;
    },
    
    /**
     * 【新增】同步推流音量与后端
     */
    async syncStreamVolumeWithBackend() {
        try {
            const response = await api.getStreamVolume();
            if (response.status === 'OK') {
                const backendVolume = response.stream_volume || 50;
                const streamVolumeSlider = document.getElementById('streamVolumeSetting');
                const streamVolumeValue = document.getElementById('streamVolumeValue');
                
                // 更新UI显示
                if (streamVolumeSlider) {
                    streamVolumeSlider.value = backendVolume;
                }
                if (streamVolumeValue) {
                    streamVolumeValue.textContent = `${backendVolume}%`;
                }
                
                // 更新localStorage
                this.setSetting('stream_volume', backendVolume);
                
                console.log(`[推流音量] 已从后端同步: ${backendVolume}%`);
                return backendVolume;
            }
        } catch (error) {
            console.warn('[推流音量] 后端同步失败，使用本地设置:', error);
            return this.getStreamVolume();
        }
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
        }
        
        // 语言
        const langSelect = document.getElementById('languageSetting');
        if (langSelect) {
            langSelect.value = settings.language || 'auto';
        }
        
        // 自动推流
        const autoStreamCheck = document.getElementById('autoStreamSetting');
        if (autoStreamCheck) {
            const autoStream = settings.auto_stream === 'true' || settings.auto_stream === true;
            autoStreamCheck.checked = autoStream;
        }
        
        // 推流音量
        const streamVolumeSlider = document.getElementById('streamVolumeSetting');
        const streamVolumeValue = document.getElementById('streamVolumeValue');
        if (streamVolumeSlider) {
            const volume = settings.stream_volume || 50;
            streamVolumeSlider.value = volume;
            if (streamVolumeValue) {
                streamVolumeValue.textContent = `${volume}%`;
            }
            
            // ✅ 初始化音频元素的音量
            const audioElement = document.getElementById('browserStreamAudio');
            if (audioElement) {
                const volumeDecimal = parseInt(volume) / 100;
                audioElement.volume = volumeDecimal;
                console.log(`[推流音量] 初始化: ${volume}% (HTML5 audio.volume = ${volumeDecimal.toFixed(2)})`);
            } else {
                console.warn('[推流音量] 警告: 初始化时未找到 browserStreamAudio 元素');
            }
        }
    },
    
    /**
     * 绑定事件
     */
    bindEvents() {
        // 推流音量滑块 - 只保存到 localStorage（前端本地偏好）
        const streamVolumeSlider = document.getElementById('streamVolumeSetting');
        const streamVolumeValue = document.getElementById('streamVolumeValue');
        if (streamVolumeSlider) {
            streamVolumeSlider.addEventListener('input', (e) => {
                const volumePercent = e.target.value;
                
                // 只保存到 localStorage（客户端本地偏好）
                this.setSetting('stream_volume', volumePercent);
                if (streamVolumeValue) {
                    streamVolumeValue.textContent = `${volumePercent}%`;
                }
                
                // 应用到 HTML5 audio 元素（浏览器音量）
                const audioElement = document.getElementById('browserStreamAudio');
                if (audioElement) {
                    const volumeDecimal = parseInt(volumePercent) / 100;
                    audioElement.volume = volumeDecimal;
                }
                
                console.log(`[推流音量] 已保存到 localStorage: ${volumePercent}%（仅影响本浏览器）`);
            });
        }
        
        // 推流开关 - 用户切换时保存到 localStorage
        const autoStreamCheck = document.getElementById('autoStreamSetting');
        if (autoStreamCheck) {
            autoStreamCheck.addEventListener('change', async (e) => {
                const isEnabled = e.target.checked;
                
                console.log(`%c[推流开关] 用户操作: ${isEnabled ? '✓ 启用' : '✗ 禁用'}`, 
                    `color: ${isEnabled ? '#4CAF50' : '#FF9800'}; font-weight: bold`);
                
                // 如果用户要启用推流，先检查服务器是否允许
                if (isEnabled) {
                    try {
                        const response = await api.get('/config/streaming-enabled');
                        if (!response.streaming_enabled) {
                            console.warn('[推流] 服务器已禁用推流功能');
                            this.showNotification('❌ 服务器已禁用推流功能', 'error');
                            // 取消选中
                            autoStreamCheck.checked = false;
                            // 更新指示器为禁止状态
                            this.updateStreamStatusIndicator('disabled');
                            return;
                        }
                    } catch (error) {
                        console.error('[推流] 检查服务器推流状态失败:', error);
                        this.showNotification('❌ 无法检查推流状态，请稍后重试', 'error');
                        autoStreamCheck.checked = false;
                        return;
                    }
                }
                
                // 保存到 localStorage（仅作为权限标记）
                this.setSetting('auto_stream', isEnabled);
                localStorage.setItem('streamActive', isEnabled ? 'true' : 'false');
                console.log(`[设置] localStorage.streamActive = ${isEnabled ? 'true' : 'false'}`);
                
                if (isEnabled) {
                    console.log('[推流权限] 用户启用推流权限');
                    // 更新指示器为关闭状态（等待用户点击启动）
                    this.updateStreamStatusIndicator('closed');
                    this.showNotification('✓ 推流权限已启用\n💡 请点击顶部推流指示器开始播放', 'success');
                } else {
                    console.log('[推流权限] 用户禁用推流权限');
                    // 如果当前正在推流，停止它
                    if (this.streamAudio && !this.streamAudio.paused) {
                        console.log('[推流权限] 检测到正在播放的推流，正在停止...');
                        this.stopStream();
                    }
                    // 更新指示器为关闭状态
                    this.updateStreamStatusIndicator('closed');
                    this.showNotification('✓ 已禁用推流权限', 'success');
                }
            });
        }
        
        // 主题切换
        const themeSelect = document.getElementById('themeSetting');
        if (themeSelect) {
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
        
        // 如果是自动模式，根据时间决定主题
        let actualTheme = theme;
        if (theme === 'auto') {
            const hour = new Date().getHours();
            // 6:00 - 18:00 使用亮色主题，其他时间使用暗色主题
            actualTheme = (hour >= 6 && hour < 18) ? 'light' : 'dark';
            console.log(`[设置] 自动主题模式: 当前时间 ${hour}:00, 使用 ${actualTheme} 主题`);
        }
        
        console.log(`[设置] 准备应用主题: ${actualTheme}`);
        
        // 调用 themeManager 加载主题 CSS 和应用主题 class
        if (themeManager) {
            themeManager.loadTheme(actualTheme, () => {
                console.log(`[设置] themeManager 已应用主题: ${actualTheme}`);
            });
        }
        
        // 应用 data-theme 属性
        document.documentElement.setAttribute('data-theme', actualTheme);
        
        // 统一的主题类名
        const themeClass = actualTheme === 'light' ? 'theme-light' : 'theme-dark';
        
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
        
        // 更新主题选项 (HTML顺序: auto, dark, light)
        const themeSelect = document.getElementById('themeSetting');
        if (themeSelect) {
            const options = themeSelect.querySelectorAll('option');
            if (options[0]) options[0].textContent = i18n.t('settings.theme.auto', language);
            if (options[1]) options[1].textContent = i18n.t('settings.theme.dark', language);
            if (options[2]) options[2].textContent = i18n.t('settings.theme.light', language);
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
                language: document.getElementById('languageSetting')?.value || 'auto',
                auto_stream: document.getElementById('autoStreamSetting')?.checked !== false,
                stream_volume: parseInt(document.getElementById('streamVolumeSetting')?.value || 50)
            };
            
            // 保存推流激活状态到 localStorage（用于页面刷新后恢复）
            localStorage.setItem('streamActive', updates.auto_stream ? 'true' : 'false');
            console.log('[设置] 推流激活状态已保存:', updates.auto_stream);
            
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
                language: 'zh',
                auto_stream: false,  // 推流功能默认关闭
                stream_volume: 50
            };
            
            // 设置表单元素为默认值
            const themeEl = document.getElementById('themeSetting');
            const languageEl = document.getElementById('languageSetting');
            const autoStreamEl = document.getElementById('autoStreamSetting');
            const streamVolumeEl = document.getElementById('streamVolumeSetting');
            const streamVolumeValueEl = document.getElementById('streamVolumeValue');
            
            if (themeEl) themeEl.value = defaults.theme;
            if (languageEl) languageEl.value = defaults.language;
            if (autoStreamEl) autoStreamEl.checked = defaults.auto_stream;
            if (streamVolumeEl) {
                streamVolumeEl.value = defaults.stream_volume;
                if (streamVolumeValueEl) streamVolumeValueEl.textContent = defaults.stream_volume + '%';
            }
            
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
     * [已禁用] 检查并启动自动推流（改为手动点击推流指示器启动）
     */
    checkAndStartAutoStream(streamFormat = 'mp3') {
        // 自动推流已禁用，始终返回
        console.log('[自动推流] 已禁用，请点击推流指示器手动启动');
        return;
        
        // 检查自动推流设置是否启用
        if (!this.settings.auto_stream) {
            console.log('[自动推流] 未启用，跳过');
            // 保存推流状态为关闭
            localStorage.setItem('streamActive', 'false');
            return;
        }
        
        console.log('[自动推流] 已启用，准备在浏览器中播放推流音频...');
        
        // 保存推流激活状态到 localStorage
        localStorage.setItem('streamActive', 'true');
        
        // 获取推流音量设置
        const streamVolume = this.settings.stream_volume || 50;
        const volumeLevel = streamVolume / 100;
        
        // 启动浏览器推流
        this.playStreamAudio(streamFormat, volumeLevel);
    },
    
    /**
     * 在浏览器中播放推流音频
     */
    playStreamAudio(streamFormat = 'mp3', volume = 0.5) {
        const audioElement = document.getElementById('browserStreamAudio');
        
        if (!audioElement) {
            console.warn('[推流音频] 浏览器音频元素不存在，可能需要在 HTML 中添加 <audio id="browserStreamAudio">');
            return;
        }
        
        try {
            console.log(`[推流音频] 准备播放推流 (格式: ${streamFormat}, 音量: ${Math.round(volume * 100)}%)`);
            
            // 获取状态文本显示元素
            const statusEl = document.getElementById('miniPlayerStatus');
            if (!statusEl) {
                console.warn('[推流] 未找到miniPlayerStatus元素');
            }
            
            // 显示状态文本的辅助函数
            let statusTimeout = null;
            const showStatus = (text, autoHide = false) => {
                if (statusEl) {
                    statusEl.textContent = text;
                    statusEl.classList.add('show');
                    
                    // 清理之前的定时器
                    if (statusTimeout) {
                        clearTimeout(statusTimeout);
                    }
                    
                    // 自动隐藏
                    if (autoHide) {
                        statusTimeout = setTimeout(() => {
                            statusEl.classList.remove('show');
                        }, 3000);
                    }
                }
            };
            
            // 停止之前的推流（如有）
            if (!audioElement.paused) {
                console.log('[推流音频] 停止之前的推流');
                audioElement.pause();
            }
            
            // 清理旧的源
            audioElement.src = '';
            audioElement.currentTime = 0;
            
            // 设置新源
            const timestamp = Date.now();
            const streamUrl = `/stream/play?format=${streamFormat}&t=${timestamp}`;
            
            console.log('[推流音频] 设置流地址:', streamUrl);
            
            // 显示初始状态
            showStatus('🔄 正在连接...');
            
            audioElement.crossOrigin = 'anonymous';
            audioElement.volume = Math.max(0, Math.min(1, volume));
            audioElement.src = streamUrl;
            audioElement.load();  // 明确加载媒体
            
            // 设置事件监听
            audioElement.onloadstart = () => {
                console.log('[推流音频] 开始加载流数据');
                showStatus('🔄 开始连接...');
            };
            
            audioElement.onprogress = () => {
                console.log('[推流音频] 正在缓冲数据');
                // 只在连接阶段显示，播放时不显示进度
            };
            
            audioElement.onloadedmetadata = () => {
                console.log('[推流音频] ✓ 元数据已加载');
                showStatus('📦 准备就绪...');
            };
            
            audioElement.oncanplay = () => {
                console.log('[推流音频] ✓ 可以开始播放');
                showStatus('✓ 准备就绪...');
            };
            
            audioElement.onplay = () => {
                console.log('[推流音频] ✓ 开始播放');
                showStatus('▶ 正在播放...', true);
            };
            
            audioElement.onplaying = () => {
                console.log('[推流音频] ✓ 正在播放');
                // 有声音播放后自动隐藏
                if (statusEl) {
                    statusEl.classList.remove('show');
                }
            };
            
            audioElement.onerror = (error) => {
                console.error('[推流音频] ✗ 播放出错:', error, audioElement.error);
                showStatus('❌ 连接失败', true);
            };
            
            audioElement.onpause = () => {
                console.log('[推流音频] 已暂停');
            };
            
            audioElement.ondurationchange = () => {
                console.log('[推流音频] 时长已更新');
            };
            
            // 仅加载流，不自动播放（浏览器要求用户交互才能播放）
            console.log('[推流音频] 推流已加载，等待用户交互...');
            showStatus('👆 点击推流指示器开始播放', false);
            
        } catch (error) {
            console.error('[推流音频] 播放异常:', error);
        }
    },
    
    /**
     * 停止推流
     */
    stopStream() {
        const audioElement = document.getElementById('browserStreamAudio');
        
        if (!audioElement) {
            console.warn('[推流音频] 音频元素不存在');
            return;
        }
        
        try {
            console.log('[推流音频] 正在停止推流...');
            
            // 隐藏状态文本
            const statusEl = document.getElementById('miniPlayerStatus');
            if (statusEl) {
                statusEl.classList.remove('show');
                statusEl.textContent = '';
            }
            
            // 暂停播放
            if (!audioElement.paused) {
                console.log('[推流音频] 暂停音频播放');
                audioElement.pause();
            }
            
            // 清空源
            audioElement.src = '';
            audioElement.currentTime = 0;
            
            // 移除所有事件监听器
            audioElement.onplay = null;
            audioElement.onpause = null;
            audioElement.onerror = null;
            audioElement.onloadstart = null;
            audioElement.onloadedmetadata = null;
            audioElement.onplaying = null;
            audioElement.ondurationchange = null;
            audioElement.onprogress = null;
            audioElement.oncanplay = null;
            
            console.log('[推流音频] ✓ 推流已完全断开');
        } catch (error) {
            console.error('[推流音频] 停止推流异常:', error);
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
