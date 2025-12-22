"""日志管理系统 - 支持按模块、路由、级别可配置的日志控制"""

import logging
import random
import os
from configparser import ConfigParser


class LoggingManager:
    """可配置的日志管理器，支持按模块/级别/路由过滤"""
    
    DEFAULT_CONFIG = {
        'level': 'INFO',
        'modules': {
            'stream': True,
            'player': True,
            'settings': True,
            'app': True,
            'uvicorn': True,
        },
        'routes': {
            'status': False,          # 过滤 /status
            'stream_status': False,   # 过滤 /stream/status
            'volume': False,          # 过滤音量控制
        },
        'polling_sample_rate': 0.1,  # 采样率 (1/10)
    }
    
    def __init__(self):
        self.config = self.load_from_ini()
    
    @classmethod
    def load_from_ini(cls):
        """从 settings.ini 加载日志配置"""
        config = cls.DEFAULT_CONFIG.copy()
        config['modules'] = cls.DEFAULT_CONFIG['modules'].copy()
        config['routes'] = cls.DEFAULT_CONFIG['routes'].copy()
        
        try:
            config_path = os.path.join(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                'settings.ini'
            )
            
            if os.path.exists(config_path):
                ini = ConfigParser()
                ini.read(config_path, encoding='utf-8')
                
                if ini.has_section('logging'):
                    # 读取日志级别
                    if ini.has_option('logging', 'level'):
                        config['level'] = ini.get('logging', 'level').upper()
                    
                    # 读取模块过滤
                    for module in config['modules'].keys():
                        key = f'module_{module}'
                        if ini.has_option('logging', key):
                            config['modules'][module] = ini.getboolean('logging', key)
                    
                    # 读取路由过滤
                    for route in config['routes'].keys():
                        key = f'route_{route}'
                        if ini.has_option('logging', key):
                            config['routes'][route] = ini.getboolean('logging', key)
                    
                    # 读取采样率
                    if ini.has_option('logging', 'polling_sample_rate'):
                        config['polling_sample_rate'] = ini.getfloat('logging', 'polling_sample_rate')
        
        except Exception as e:
            print(f"⚠️ 加载日志配置失败: {e}，使用默认值")
        
        return config


class ModuleFilter(logging.Filter):
    """按模块名过滤日志（白名单模式：只显示配置中启用的模块）"""
    
    def __init__(self, logging_manager):
        super().__init__()
        self.logging_manager = logging_manager
    
    def filter(self, record):
        # 获取模块名 (e.g., "models.stream" → "stream")
        module_name = record.name.split('.')[-1] if '.' in record.name else record.name
        
        # 检查模块是否启用（配置中明确设置为 True 才显示）
        modules = self.logging_manager.config.get('modules', {})
        should_allow = modules[module_name] if module_name in modules else False
        
        return should_allow


class RouteFilter(logging.Filter):
    """按 API 路由过滤日志 - 对高频请求进行采样"""
    
    def __init__(self, logging_manager):
        super().__init__()
        self.logging_manager = logging_manager
    
    def filter(self, record):
        # 检查日志消息中是否包含需要采样的路由名
        message = record.getMessage()
        routes = self.logging_manager.config.get('routes', {})
        
        for route_name, should_filter in routes.items():
            if route_name in message and should_filter:
                # 对该路由的日志进行采样
                sample_rate = self.logging_manager.config.get('polling_sample_rate', 0.1)
                return random.random() < sample_rate
        
        return True  # 默认允许


class UvicornAccessLogFilter(logging.Filter):
    """Uvicorn 访问日志过滤器 - 对高频 polling 请求进行采样"""
    
    def __init__(self, logging_manager=None):
        super().__init__()
        if logging_manager is None:
            logging_manager = LoggingManager()
        self.logging_manager = logging_manager
    
    def filter(self, record):
        message = record.getMessage()
        
        # 检查是否为需要采样的路由
        routes = self.logging_manager.config.get('routes', {})
        for route_name, should_filter in routes.items():
            if route_name in message and should_filter:
                # 采样：只记录 1/10 的请求
                sample_rate = self.logging_manager.config.get('polling_sample_rate', 0.1)
                if random.random() >= sample_rate:
                    return False  # 过滤掉这条日志
        
        return True  # 默认允许


class LevelFilter(logging.Filter):
    """按日志级别过滤"""
    
    def __init__(self, min_level_name):
        super().__init__()
        self.min_level = getattr(logging, str(min_level_name).upper(), logging.INFO)
    
    def filter(self, record):
        return record.levelno >= self.min_level


def setup_logging(logging_manager=None):
    """设置日志系统，支持可配置的过滤
    
    Args:
        logging_manager: LoggingManager 实例，如果为None则自动创建
    
    Returns:
        LoggingManager 实例
    """
    if logging_manager is None:
        logging_manager = LoggingManager()
    
    # 获取日志级别
    log_level = logging_manager.config.get('level', 'INFO')
    level_int = getattr(logging, str(log_level).upper(), logging.INFO)
    
    # 获取根 logger
    root_logger = logging.getLogger()
    
    # 设置根 logger 的级别
    root_logger.setLevel(level_int)
    
    # 创建过滤器实例
    module_filter = ModuleFilter(logging_manager)
    route_filter = RouteFilter(logging_manager)
    level_filter = LevelFilter(log_level)
    
    # 移除已存在的过滤器
    for filt in list(root_logger.filters):
        root_logger.removeFilter(filt)
    
    # 如果没有处理器，添加一个默认的 StreamHandler
    if not root_logger.handlers:
        handler = logging.StreamHandler()
        handler.setLevel(level_int)
        # 【修改】移除日志中的时间戳显示
        formatter = logging.Formatter(
            '[%(name)s] %(levelname)s: %(message)s'
        )
        handler.setFormatter(formatter)
        root_logger.addHandler(handler)
    
    # 清除所有处理器的过滤器，然后添加我们的过滤器
    for handler in root_logger.handlers:
        # 清除已有的过滤器
        for filt in list(handler.filters):
            handler.removeFilter(filt)
        # 添加我们的过滤器
        handler.addFilter(module_filter)
        handler.addFilter(route_filter)
        handler.addFilter(level_filter)
    
    # 同时添加到根 logger（以防万一）
    root_logger.addFilter(module_filter)
    root_logger.addFilter(route_filter)
    root_logger.addFilter(level_filter)
    
    return logging_manager
