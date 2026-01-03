# -*- coding: utf-8 -*-
"""日志配置模块 - 为整个应用提供统一的 logger"""

import logging
import sys
import os
import configparser

# ==================== 日志颜色常量 ====================

class Colors:
    """ANSI 颜色代码"""
    RESET = '\033[0m'
    
    # 文本颜色
    GRAY = '\033[90m'
    RED = '\033[91m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    MAGENTA = '\033[95m'
    CYAN = '\033[96m'
    WHITE = '\033[97m'
    
    # 背景颜色
    BG_BLUE = '\033[44m'
    BG_CYAN = '\033[46m'


class ColoredFormatter(logging.Formatter):
    """带颜色的日志格式化器"""
    
    LEVEL_COLORS = {
        'DEBUG': Colors.CYAN,
        'INFO': Colors.GREEN,
        'WARNING': Colors.YELLOW,
        'ERROR': Colors.RED,
        'CRITICAL': Colors.RED + Colors.BG_BLUE,
    }
    
    MODULE_COLORS = {
        'player': Colors.BLUE,
        'app': Colors.GREEN,
        'playlist': Colors.CYAN,
        'settings': Colors.YELLOW,
        'uvicorn': Colors.CYAN,      # Uvicorn 主日志
        'error': Colors.CYAN,        # uvicorn.error 显示为 uvicorn
        'access': Colors.GRAY,       # uvicorn.access
    }
    
    def format(self, record):
        # 获取级别颜色
        level_color = self.LEVEL_COLORS.get(record.levelname, Colors.WHITE)
        
        # 解析模块名
        module_parts = record.name.split('.')
        module_name = module_parts[-1] if module_parts else 'root'
        
        # 特殊处理 Uvicorn 日志器：uvicorn.error → uvicorn
        if len(module_parts) >= 2 and module_parts[0] == 'uvicorn':
            if module_parts[1] == 'error':
                module_name = 'uvicorn'
            elif module_parts[1] == 'access':
                module_name = 'access'
        
        # 获取模块颜色
        module_color = self.MODULE_COLORS.get(module_name, Colors.GRAY)
        
        # 格式化级别名（固定5个字符宽度）
        level_str = f"{level_color}[{record.levelname:^5}]{Colors.RESET}"
        
        # 格式化模块名（固定10个字符宽度）
        module_str = f"{module_color}{module_name:>10}{Colors.RESET}"
        
        # 组合日志消息
        message = record.getMessage()
        
        # 最终格式: [LEVEL] module | message
        return f"{level_str} {module_str} {Colors.GRAY}|{Colors.RESET} {message}"


# ==================== 日志配置常量 ====================

DEFAULT_LOG_LEVEL = 'INFO'
DEFAULT_POLLING_SAMPLE_RATE = 0.1
DEFAULT_FILTERED_PATHS = {'/status', '/volume'}
DEFAULT_HEARTBEAT_LOG_INTERVAL = 10


def load_logging_config():
    """从 settings.ini 加载日志配置"""
    config = {
        'level': DEFAULT_LOG_LEVEL,
        'polling_sample_rate': DEFAULT_POLLING_SAMPLE_RATE,
        'filtered_paths': DEFAULT_FILTERED_PATHS,
        'heartbeat_log_interval': DEFAULT_HEARTBEAT_LOG_INTERVAL,
    }
    
    try:
        ini_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            'settings.ini'
        )
        
        if os.path.exists(ini_path):
            ini = configparser.ConfigParser()
            ini.read(ini_path, encoding='utf-8')
            
            if ini.has_section('logging'):
                # 读取日志级别
                if ini.has_option('logging', 'level'):
                    config['level'] = ini.get('logging', 'level').upper()
                
                # 读取采样率
                if ini.has_option('logging', 'polling_sample_rate'):
                    try:
                        config['polling_sample_rate'] = float(ini.get('logging', 'polling_sample_rate'))
                    except ValueError:
                        pass
                
                # 读取过滤路由
                if ini.has_option('logging', 'filtered_paths'):
                    paths_str = ini.get('logging', 'filtered_paths')
                    config['filtered_paths'] = {p.strip() for p in paths_str.split(',')}
                
                # 读取心跳日志采样间隔
                if ini.has_option('logging', 'heartbeat_log_interval'):
                    try:
                        config['heartbeat_log_interval'] = float(ini.get('logging', 'heartbeat_log_interval'))
                    except ValueError:
                        pass
    
    except Exception as e:
        print(f"⚠️ 加载日志配置失败: {e}，使用默认值")
    
    return config


# 加载全局日志配置
_LOGGING_CONFIG = load_logging_config()


# ==================== 模块级别 Logger ====================

def _setup_module_logger():
    """创建模块级别的 logger"""
    logger = logging.getLogger(__name__)
    
    # 避免重复配置
    if logger.handlers:
        return logger
    
    logger.setLevel(logging.DEBUG)
    
    # 创建控制台处理器
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(logging.DEBUG)
    
    # 使用美化的格式化器
    formatter = ColoredFormatter()
    handler.setFormatter(formatter)
    
    # 添加处理器
    logger.addHandler(handler)
    
    # 防止日志向上传播
    logger.propagate = False
    
    return logger


# 创建模块级别的 logger
logger = _setup_module_logger()


# ==================== 日志过滤函数（可选）====================

class PollingRequestFilter(logging.Filter):
    """过滤高频请求的日志采样"""
    
    def __init__(self, filtered_paths=None, sample_rate=None):
        super().__init__()
        self.filtered_paths = filtered_paths or _LOGGING_CONFIG['filtered_paths']
        self.sample_rate = sample_rate or _LOGGING_CONFIG['polling_sample_rate']
    
    def filter(self, record):
        import random
        
        message = record.getMessage()
        
        # 检查是否为高频路由
        for path in self.filtered_paths:
            if path in message:
                # 采样：只记录一部分请求
                return random.random() < self.sample_rate
        
        return True  # 其他日志全部通过


def setup_logging(debug=None):
    """配置应用级别的日志
    
    Args:
        debug: 是否启用调试日志（None 时从配置读取）
    """
    # 从全局配置读取日志级别
    level_str = _LOGGING_CONFIG['level']
    log_level = getattr(logging, level_str, logging.INFO)
    
    # 如果明确指定 debug，覆盖配置
    if debug is True:
        log_level = logging.DEBUG
    elif debug is False:
        log_level = logging.INFO
    
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)
    
    # 清除已有的处理器
    for handler in list(root_logger.handlers):
        root_logger.removeHandler(handler)
    
    # 创建控制台处理器
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(log_level)
    
    # 使用美化的格式化器
    formatter = ColoredFormatter()
    handler.setFormatter(formatter)
    
    # 添加处理器和过滤器
    handler.addFilter(PollingRequestFilter(
        filtered_paths=_LOGGING_CONFIG['filtered_paths'],
        sample_rate=_LOGGING_CONFIG['polling_sample_rate']
    ))
    root_logger.addHandler(handler)
    
    return logger


# ==================== 便捷函数 ====================

def get_logger(name):
    """获取指定名称的 logger
    
    Args:
        name: logger 名称，通常是 __name__
    
    Returns:
        logging.Logger 实例
    """
    return logging.getLogger(name)


# 初始化模块 logger
if __name__ != '__main__':
    # 非直接运行时，初始化根 logger
    setup_logging()

