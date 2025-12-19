/**
 * 用户设置管理模块
 */

import { Toast } from './ui.js';
import { themeManager } from './themeManager.js';
import { i18n } from './i18n.js';

export const settingsManager = {
    settings: {},
    schema: {},
    
    /**
     * 初始化设置管理器
     */
    async init() {
        try {
            console.log('[设置] 初始化设置管理器...');
            
            // 加载设置和schema
            await this.loadSettings();
            await this.loadSchema();
            
            // 应用主题
            this.applyTheme();
            
            // 应用语言
            this.applyLanguage();
            
            // 绑定事件
            this.bindEvents();
            
            console.log('✓ 设置管理器已初始化');
        } catch (error) {
            console.error('[设置] 初始化失败:', error);
        }
    },
    
    /**
     * 加载设置
     */
    async loadSettings() {
        try {
            const response = await fetch('/settings');
            const result = await response.json();
            
            if (result.status === 'OK') {
                this.settings = result.data;
                this.updateUI();
                console.log('[设置] 已加载:', this.settings);
            }
        } catch (error) {
            console.error('[设置] 加载失败:', error);
        }
    },
    
    /**
     * 加载设置schema
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
        // 主题
        const themeSelect = document.getElementById('themeSetting');
        if (themeSelect) {
            themeSelect.value = this.settings.theme || 'dark';
        }
        
        // 语言 - 显示用户设置的值（可能是auto/zh/en）
        const langSelect = document.getElementById('languageSetting');
        if (langSelect) {
            // 使用后端设置的语言值（可能是 auto/zh/en）
            langSelect.value = this.settings.language || 'auto';
        }
        
        // 自动推流
        const autoStreamCheck = document.getElementById('autoStreamSetting');
        if (autoStreamCheck) {
            autoStreamCheck.checked = this.settings.auto_stream !== false;
        }
        
        // 推流音量
        const streamVolumeSlider = document.getElementById('streamVolumeSetting');
        const streamVolumeValue = document.getElementById('streamVolumeValue');
        if (streamVolumeSlider) {
            streamVolumeSlider.value = this.settings.stream_volume || 50;
            if (streamVolumeValue) {
                streamVolumeValue.textContent = `${streamVolumeSlider.value}%`;
            }
        }
    },
    
    /**
     * 绑定事件
     */
    bindEvents() {
        // 推流音量滑块实时更新
        const streamVolumeSlider = document.getElementById('streamVolumeSetting');
        const streamVolumeValue = document.getElementById('streamVolumeValue');
        if (streamVolumeSlider) {
            streamVolumeSlider.addEventListener('input', (e) => {
                if (streamVolumeValue) {
                    streamVolumeValue.textContent = `${e.target.value}%`;
                }
            });
        }
        
        // 接收推流开关 - 用户切换时立即保存并启动推流
        const autoStreamCheck = document.getElementById('autoStreamSetting');
        if (autoStreamCheck) {
            autoStreamCheck.addEventListener('change', (e) => {
                console.log('[接收推流] 开关已切换:', e.target.checked);
                
                const isEnabled = e.target.checked;
                
                if (isEnabled) {
                    // 启用推流
                    console.log('[接收推流] 用户启用推流，正在注册...');
                    this.showNotification('🔄 正在注册推流服务...', 'info');
                } else {
                    // 禁用推流
                    console.log('[接收推流] 用户禁用推流');
                    this.showNotification('🔌 已关闭接收推流', 'info');
                }
                
                // 立即保存接收推流设置
                this.settings.auto_stream = isEnabled;
                
                // 保存到 localStorage
                localStorage.setItem('streamActive', isEnabled ? 'true' : 'false');
                
                // 发送到服务器保存
                fetch('/settings/auto_stream', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ value: isEnabled })
                }).then(res => res.json())
                  .then(result => {
                    if (result.status === 'OK') {
                        console.log('[接收推流] 设置已保存');
                        
                        if (isEnabled) {
                            // 启用推流的提示
                            this.showNotification('✓ 注册成功！推流已启用', 'success');
                            
                            console.log('[接收推流] 检查是否有正在播放的歌曲...');
                            
                            // 检查是否有歌曲正在播放
                            const player = window.app && window.app.player;
                            if (player && player.currentPlayingUrl) {
                                console.log('[接收推流] ✓ 检测到正在播放的歌曲:', player.currentPlayingUrl);
                                console.log('[接收推流] 立即启动推流...');
                                
                                const streamFormat = localStorage.getItem('streamFormat') || 'mp3';
                                const streamVolume = this.settings.stream_volume || 50;
                                
                                // 显示推流启动中的提示
                                this.showNotification(
                                    `📻 开始播放推流 (${streamFormat.toUpperCase()}, ${streamVolume}%)...`,
                                    'info'
                                );
                                
                                // 启动推流
                                this.playStreamAudio(streamFormat, streamVolume / 100);
                            } else {
                                console.log('[接收推流] ⓘ 暂无正在播放的歌曲，后续播放时自动启动推流');
                                this.showNotification('⏳ 推流已就绪，播放歌曲时自动启动', 'info');
                            }
                        } else {
                            // 禁用推流的处理
                            console.log('[接收推流] 禁用推流，停止播放推流音频...');
                            
                            // 立即停止推流
                            this.stopStream();
                            
                            // 显示禁用成功提示
                            this.showNotification('✓ 已禁用接收推流', 'success');
                        }
                    }
                  })
                  .catch(err => {
                    console.error('[接收推流] 保存失败:', err);
                    this.showNotification('❌ 注册失败，请重试', 'error');
                  });
            });
        }
        
        // 主题切换
        const themeSelect = document.getElementById('themeSetting');
        if (themeSelect) {
            themeSelect.addEventListener('change', (e) => {
                this.applyTheme(e.target.value);
            });
        }
        
        // 语言切换
        const langSelect = document.getElementById('languageSetting');
        if (langSelect) {
            langSelect.addEventListener('change', (e) => {
                this.applyLanguage(e.target.value);
            });
        }
        
        // 保存按钮
        const saveBtn = document.getElementById('saveSettingsBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveSettings());
        }
        
        // 重置按钮
        const resetBtn = document.getElementById('resetSettingsBtn');
        console.log('[DEBUG] resetBtn element:', resetBtn);
        if (resetBtn) {
            console.log('[DEBUG] 绑定重置按钮事件...');
            resetBtn.addEventListener('click', () => this.resetSettings());
        } else {
            console.error('[DEBUG] 未找到 resetBtn 元素!');
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
            theme = this.settings.theme || 'dark';
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
        
        // 应用 body 类名（themeManager 会应用，但我们也保证它）
        const body = document.body;
        body.classList.remove('theme-dark', 'theme-light');
        body.classList.add(themeClass);
        console.log(`[设置] body 类名已更新: ${body.className}`);
        
        // 应用歌单类名（使用相同的类名）
        const playlistEl = document.getElementById('playlist');
        if (playlistEl) {
            playlistEl.classList.remove('theme-dark', 'theme-light', 'bright-theme', 'dark-theme');
            playlistEl.classList.add(themeClass);
            console.log(`[设置] playlist 类名已更新: ${playlistEl.className}`);
        } else {
            console.warn(`[设置] 未找到 playlist 元素，稍后重试...`);
            // 如果还没有 playlist 元素，延迟重试
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
            language = this.settings.language || i18n.currentLanguage || 'zh';
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
        
        // 更新按钮文本
        const resetBtn = document.getElementById('resetSettingsBtn');
        if (resetBtn) resetBtn.textContent = i18n.t('settings.reset', language);
        
        const saveBtn = document.getElementById('saveSettingsBtn');
        if (saveBtn) saveBtn.textContent = i18n.t('settings.save', language);
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
     * 检查并启动自动推流（歌曲播放后自动播放推流）
     */
    checkAndStartAutoStream(streamFormat = 'mp3') {
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
            
            // 创建进度条
            let progressBar = document.getElementById('streamProgressBar');
            if (!progressBar) {
                progressBar = document.createElement('div');
                progressBar.id = 'streamProgressBar';
                progressBar.style.cssText = `
                    background: rgba(0,0,0,0.8);
                    border-radius: 20px;
                    padding: 8px 12px;
                    z-index: 9999;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
                    color: white;
                    font-size: 11px;
                    display: none;
                    flex-shrink: 0;
                `;
                
                // 将进度条插入到 streamProgressBarContainer 中
                const container = document.getElementById('streamProgressBarContainer');
                if (container) {
                    container.appendChild(progressBar);
                    console.log('[推流进度条] 已插入到 streamProgressBarContainer');
                } else {
                    console.warn('[推流进度条] 未找到 streamProgressBarContainer');
                }
            }
            
            const showProgress = (status, percent = 0) => {
                progressBar.innerHTML = `
                    <div style="margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                        <span style="white-space: nowrap; flex-shrink: 0;">${status}</span>
                        <div style="flex: 1; min-width: 80px; height: 4px; background: rgba(255,255,255,0.2); border-radius: 2px; overflow: hidden;">
                            <div style="height: 100%; background: linear-gradient(90deg, #4CAF50, #45a049); width: ${percent}%; transition: width 0.3s; border-radius: 2px;"></div>
                        </div>
                        <span style="white-space: nowrap; flex-shrink: 0; min-width: 30px; text-align: right;">${percent}%</span>
                    </div>
                `;
                progressBar.style.display = 'block';
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
            
            // 显示初始进度
            showProgress('📡 正在连接...', 5);
            
            audioElement.crossOrigin = 'anonymous';
            audioElement.volume = Math.max(0, Math.min(1, volume));
            audioElement.src = streamUrl;
            audioElement.load();  // 明确加载媒体
            
            // 设置事件监听 - 各阶段更新进度条
            audioElement.onloadstart = () => {
                console.log('[推流音频] 开始加载流数据');
                showProgress('📡 开始连接...', 10);
            };
            
            audioElement.onprogress = () => {
                // 计算真实的缓冲百分比
                const buffered = audioElement.buffered;
                let bufferedPercent = 0;
                
                if (buffered && buffered.length > 0) {
                    const duration = audioElement.duration;
                    if (duration && duration > 0 && isFinite(duration)) {
                        const bufferedEnd = buffered.end(buffered.length - 1);
                        bufferedPercent = Math.round((bufferedEnd / duration) * 100);
                        // 显示真实的百分比，但限制在合理范围（不超过100%）
                        bufferedPercent = Math.min(bufferedPercent, 100);
                    }
                }
                
                console.log('[推流音频] 正在缓冲数据，进度:', bufferedPercent + '%');
                showProgress(`📥 正在缓冲数据... ${bufferedPercent}%`, bufferedPercent);
            };
            
            audioElement.onloadedmetadata = () => {
                console.log('[推流音频] ✓ 元数据已加载');
                showProgress('📦 元数据已加载...', 50);
            };
            
            audioElement.oncanplay = () => {
                console.log('[推流音频] ✓ 可以开始播放');
                showProgress('✓ 准备就绪...', 75);
            };
            
            audioElement.onplay = () => {
                console.log('[推流音频] ✓ 开始播放');
                showProgress('▶ 开始播放...', 90);
            };
            
            audioElement.onplaying = () => {
                console.log('[推流音频] ✓ 正在播放');
                showProgress('🎵 播放中...', 100);
                
                // 歌曲正常播放时立即隐藏进度条
                progressBar.style.display = 'none';
            };
            
            audioElement.onerror = (error) => {
                console.error('[推流音频] ✗ 播放出错:', error, audioElement.error);
                showProgress('❌ 连接失败', 0);
                setTimeout(() => {
                    progressBar.style.display = 'none';
                }, 2000);
            };
            
            audioElement.onpause = () => {
                console.log('[推流音频] 已暂停');
            };
            
            audioElement.ondurationchange = () => {
                console.log('[推流音频] 时长已更新');
            };
            
            // 尝试播放
            console.log('[推流音频] 尝试播放...');
            const playPromise = audioElement.play();
            
            if (playPromise !== undefined) {
                playPromise
                    .then(() => {
                        console.log('[推流音频] ✓ 播放成功');
                    })
                    .catch(error => {
                        console.error('[推流音频] ✗ 播放失败:', error.name, error.message);
                        showProgress('❌ 播放失败', 0);
                        setTimeout(() => {
                            progressBar.style.display = 'none';
                        }, 2000);
                        
                        // 自动播放被浏览器阻止，显示提示
                        if (error.name === 'NotAllowedError') {
                            console.warn('[推流音频] 浏览器禁用了自动播放，请用户交互后重试');
                        }
                    });
            }
            
        } catch (error) {
            console.error('[推流音频] 播放异常:', error);
        }
    },
    
    /**
     * 停止推流
     */
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
            
            // 隐藏进度条
            const progressBar = document.getElementById('streamProgressBar');
            if (progressBar) {
                console.log('[推流音频] 隐藏进度条');
                progressBar.style.display = 'none';
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
