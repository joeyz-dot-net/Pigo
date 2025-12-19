# -*- coding: utf-8 -*-
"""
用户设置管理模块
"""

import json
import os
import logging
from pathlib import Path
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

class UserSettings:
    """用户设置管理器"""
    
    # 默认设置
    DEFAULT_SETTINGS = {
        "theme": "dark",  # light / dark / auto
        "auto_stream": False,  # 是否自动启动推流 - 默认关闭，只有用户显式启用时才执行
        "stream_volume": 50,  # 推流音量 0-100
        "language": "auto",  # auto / zh / en
    }
    
    def __init__(self, settings_file: str = "user_settings.json"):
        """
        初始化设置管理器
        
        Args:
            settings_file: 设置文件路径
        """
        self.settings_file = settings_file
        self.settings: Dict[str, Any] = {}
        self.load()
    
    def load(self):
        """从文件加载设置"""
        try:
            if os.path.exists(self.settings_file):
                with open(self.settings_file, 'r', encoding='utf-8') as f:
                    loaded = json.load(f)
                    # 合并默认设置和加载的设置
                    self.settings = {**self.DEFAULT_SETTINGS, **loaded}
                    # 清理无效的设置键（仅保留 DEFAULT_SETTINGS 中定义的键）
                    valid_keys = set(self.DEFAULT_SETTINGS.keys())
                    current_keys = set(self.settings.keys())
                    invalid_keys = current_keys - valid_keys
                    if invalid_keys:
                        for key in invalid_keys:
                            del self.settings[key]
                        self.save()
                        logger.warning(f"[设置] 加载时移除了无效的设置键: {invalid_keys}")
                    logger.info(f"[设置] 已加载用户设置: {self.settings_file}")
            else:
                # 使用默认设置
                self.settings = self.DEFAULT_SETTINGS.copy()
                self.save()
                logger.info(f"[设置] 创建默认设置文件: {self.settings_file}")
        except Exception as e:
            logger.error(f"[设置] 加载设置失败: {e}, 使用默认设置")
            self.settings = self.DEFAULT_SETTINGS.copy()
    
    def save(self):
        """保存设置到文件"""
        try:
            with open(self.settings_file, 'w', encoding='utf-8') as f:
                json.dump(self.settings, f, indent=2, ensure_ascii=False)
            logger.info(f"[设置] 已保存用户设置")
            return True
        except Exception as e:
            logger.error(f"[设置] 保存设置失败: {e}")
            return False
    
    def get(self, key: str, default: Any = None) -> Any:
        """获取单个设置"""
        return self.settings.get(key, default)
    
    def set(self, key: str, value: Any) -> bool:
        """设置单个选项"""
        try:
            self.settings[key] = value
            success = self.save()
            if success:
                logger.info(f"[设置] 已更新 {key} = {value}")
                return True
            else:
                logger.error(f"[设置] 更新失败: 保存失败")
                return False
        except Exception as e:
            logger.error(f"[设置] 更新失败: {e}")
            return False
    
    def update(self, settings_dict: Dict[str, Any]) -> bool:
        """批量更新设置"""
        try:
            self.settings.update(settings_dict)
            success = self.save()
            if success:
                logger.info(f"[设置] 已批量更新设置")
                return True
            else:
                logger.error(f"[设置] 批量更新失败: 保存失败")
                return False
        except Exception as e:
            logger.error(f"[设置] 批量更新失败: {e}")
            return False
    
    def get_all(self) -> Dict[str, Any]:
        """获取所有设置"""
        return self.settings.copy()
    
    def reset(self):
        """重置为默认设置"""
        try:
            # 只保留 DEFAULT_SETTINGS 中的有效键
            self.settings = self.DEFAULT_SETTINGS.copy()
            success = self.save()
            if success:
                logger.info(f"[设置] 已重置为默认设置")
                return True
            else:
                logger.error(f"[设置] 重置失败：保存失败")
                return False
        except Exception as e:
            logger.error(f"[设置] 重置失败: {e}")
            return False
    
    def cleanup_invalid_settings(self):
        """清理无效的设置（仅保留 DEFAULT_SETTINGS 中定义的键）"""
        try:
            valid_keys = set(self.DEFAULT_SETTINGS.keys())
            current_keys = set(self.settings.keys())
            invalid_keys = current_keys - valid_keys
            
            if invalid_keys:
                for key in invalid_keys:
                    del self.settings[key]
                    logger.warning(f"[设置] 移除了无效的设置键: {key}")
                self.save()
                logger.info(f"[设置] 已清理无效设置")
                return True
            return False
        except Exception as e:
            logger.error(f"[设置] 清理设置失败: {e}")
            return False


# 全局设置实例
_settings_instance: Optional[UserSettings] = None

def get_settings() -> UserSettings:
    """获取全局设置实例"""
    global _settings_instance
    if _settings_instance is None:
        _settings_instance = UserSettings()
    return _settings_instance

def initialize_settings(settings_file: str = "user_settings.json") -> UserSettings:
    """初始化全局设置实例"""
    global _settings_instance
    _settings_instance = UserSettings(settings_file)
    return _settings_instance
