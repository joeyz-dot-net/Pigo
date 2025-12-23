// UI 工具函数和组件模块

// 创建 DOM 元素的辅助函数
export function createElement(tag, className = '', textContent = '') {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (textContent) element.textContent = textContent;
    return element;
}

// 格式化时间（秒转 mm:ss）
export function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// 显示通知/Toast
export class Toast {
    static show(message, type = 'info', duration = 3000) {
        const toast = createElement('div', `toast toast-${type}`);
        toast.textContent = message;
        
        // 样式 ✅ 垂直水平居中
        Object.assign(toast.style, {
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            padding: '12px 24px',
            borderRadius: '4px',
            backgroundColor: type === 'error' ? '#f44336' : type === 'success' ? '#4caf50' : '#2196f3',
            color: 'white',
            zIndex: '10000',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            opacity: '0',
            transition: 'opacity 0.3s'
        });
        
        document.body.appendChild(toast);
        
        // 淡入
        setTimeout(() => toast.style.opacity = '1', 10);
        
        // 自动移除
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => document.body.removeChild(toast), 300);
        }, duration);
    }

    static success(message, duration) {
        this.show(message, 'success', duration);
    }

    static error(message, duration) {
        this.show(message, 'error', duration);
    }

    static info(message, duration) {
        this.show(message, 'info', duration);
    }
}

// 加载指示器
export class LoadingIndicator {
    constructor() {
        this.overlay = null;
    }

    show(message = '加载中...') {
        if (this.overlay) return;

        this.overlay = createElement('div', 'loading-overlay');
        Object.assign(this.overlay.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            right: '0',
            bottom: '0',
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: '9999'
        });

        const spinner = createElement('div', 'spinner');
        spinner.innerHTML = `
            <div style="text-align: center; color: white;">
                <div class="loading-spinner"></div>
                <div style="margin-top: 12px;">${message}</div>
            </div>
        `;

        this.overlay.appendChild(spinner);
        document.body.appendChild(this.overlay);
    }

    hide() {
        if (this.overlay) {
            document.body.removeChild(this.overlay);
            this.overlay = null;
        }
    }
}

// 确认对话框
export function confirm(message, title = '确认') {
    return new Promise((resolve) => {
        const result = window.confirm(message);
        resolve(result);
    });
}

// 输入对话框
export function prompt(message, defaultValue = '') {
    return new Promise((resolve) => {
        const result = window.prompt(message, defaultValue);
        resolve(result);
    });
}

// 防抖函数
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// 节流函数
export function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// 模态框管理
export class Modal {
    constructor(id) {
        this.element = document.getElementById(id);
    }

    show() {
        if (this.element) {
            this.element.style.display = 'block';
        }
    }

    hide() {
        if (this.element) {
            this.element.style.display = 'none';
        }
    }

    toggle() {
        if (this.element) {
            const isVisible = this.element.style.display !== 'none';
            this.element.style.display = isVisible ? 'none' : 'block';
        }
    }
}

// 导出单例工具
export const loading = new LoadingIndicator();
