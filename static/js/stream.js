/**
 * 【新增】StreamManager - 推流格式管理器
 * 职责：
 * - 支持mp3/aac/flac多格式推流
 * - 格式特定的缓冲策略（AAC: 1.5x队列）
 * - 浏览器×格式组合优化
 * - 自动格式落选（若不支持则降级）
 */

class StreamManager {
    constructor() {
        this.currentFormat = 'mp3'; // 默认格式
        this.audioContext = null;
        this.audioWorklet = null;
        this.formatConfig = {
            'mp3': {
                mimeType: 'audio/mpeg',
                codec: 'mp3',
                bitrate: '128k',
                chunkSize: 192 * 1024,
                heartbeatInterval: 1.0,
                description: 'MP3 (高兼容性)'
            },
            'aac': {
                mimeType: 'audio/aac',
                codec: 'aac',
                bitrate: '96k',
                chunkSize: 128 * 1024,
                heartbeatInterval: 0.5,
                description: 'AAC (更优质量)'
            },
            'flac': {
                mimeType: 'audio/flac',
                codec: 'flac',
                bitrate: '无损',
                chunkSize: 256 * 1024,
                heartbeatInterval: 1.0,
                description: 'FLAC (无损音质)'
            }
        };
        
        this.browserConfig = {
            'safari': {
                'mp3': { queueBlocks: 512, timeout: 20 },
                'aac': { queueBlocks: 768, timeout: 15 },
                'flac': { queueBlocks: 256, timeout: 20 }
            },
            'chrome': {
                'mp3': { queueBlocks: 64, timeout: 40 },
                'aac': { queueBlocks: 96, timeout: 35 },
                'flac': { queueBlocks: 32, timeout: 40 }
            },
            'firefox': {
                'mp3': { queueBlocks: 64, timeout: 40 },
                'aac': { queueBlocks: 96, timeout: 35 },
                'flac': { queueBlocks: 32, timeout: 40 }
            },
            'edge': {
                'mp3': { queueBlocks: 64, timeout: 40 },
                'aac': { queueBlocks: 96, timeout: 35 },
                'flac': { queueBlocks: 32, timeout: 40 }
            }
        };
    }

    /**
     * 检测浏览器是否支持指定格式
     */
    canPlayFormat(format) {
        const config = this.formatConfig[format];
        if (!config) return false;

        const audio = document.createElement('audio');
        const canPlay = audio.canPlayType(config.mimeType);
        
        // 返回: '' (不支持), 'maybe' (可能), 'probably' (可能)
        return canPlay === 'probably' || canPlay === 'maybe';
    }

    /**
     * 获取最佳推流格式（带降级）
     */
    getBestFormat(preferredFormat = 'aac') {
        if (this.canPlayFormat(preferredFormat)) {
            return preferredFormat;
        }

        // 降级顺序：aac -> mp3 -> flac
        const fallbackOrder = ['mp3', 'aac', 'flac'];
        for (const fmt of fallbackOrder) {
            if (fmt !== preferredFormat && this.canPlayFormat(fmt)) {
                console.log(`[STREAM] 格式 ${preferredFormat} 不支持，降级到 ${fmt}`);
                return fmt;
            }
        }

        console.log('[STREAM] 未找到支持的音频格式，使用默认 mp3');
        return 'mp3';
    }

    /**
     * 获取浏览器×格式特定配置
     */
    getBrowserFormatConfig(format) {
        const browserName = this.detectBrowser();
        const browserCfg = this.browserConfig[browserName] || this.browserConfig['chrome'];
        return browserCfg[format] || browserCfg['mp3'];
    }

    /**
     * 检测浏览器类型
     */
    detectBrowser() {
        const ua = navigator.userAgent.toLowerCase();
        if (ua.includes('safari') && !ua.includes('chrome')) {
            return 'safari';
        } else if (ua.includes('firefox')) {
            return 'firefox';
        } else if (ua.includes('edg')) {
            return 'edge';
        } else if (ua.includes('chrome')) {
            return 'chrome';
        }
        return 'default';
    }

    /**
     * 启动推流（指定格式）
     */
    async startStream(format = null) {
        if (!format) {
            format = this.getBestFormat();
        } else {
            format = this.getBestFormat(format);
        }

        this.currentFormat = format;
        const config = this.formatConfig[format];
        const browserCfg = this.getBrowserFormatConfig(format);

        console.log(
            `[STREAM] 启动推流: 格式=${format} (${config.description}), ` +
            `浏览器=${this.detectBrowser()}, 队列=${browserCfg.queueBlocks}块`
        );

        // 向后端请求指定格式的推流
        return {
            format: format,
            config: config,
            browserConfig: browserCfg,
            url: `/stream/play?format=${format}`
        };
    }

    /**
     * 获取格式统计信息
     */
    getFormatStats() {
        return {
            currentFormat: this.currentFormat,
            config: this.formatConfig[this.currentFormat],
            browserConfig: this.getBrowserFormatConfig(this.currentFormat),
            browser: this.detectBrowser()
        };
    }

    /**
     * AAC ADTS帧检测工具
     */
    isADTSFrame(data, offset = 0) {
        if (offset + 2 > data.length) return false;
        // ADTS 同步字：0xFFF...（前11位全1）
        return (data[offset] === 0xFF) && ((data[offset + 1] & 0xF0) === 0xF0);
    }

    /**
     * 解析AAC ADTS帧长度
     */
    parseADTSFrameLength(data, offset = 0) {
        if (offset + 4 > data.length) return null;
        // 字节3-4（共13位）含有帧长度
        const len = ((data[offset + 3] & 0x03) << 11) | 
                    (data[offset + 4] << 3) | 
                    ((data[offset + 5] >> 5) & 0x07);
        return len > 0 ? len : null;
    }
}

// 导出为ES6模块
export const streamManager = new StreamManager();
