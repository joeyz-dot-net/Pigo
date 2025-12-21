# -*- coding: utf-8 -*-
"""
FastAPI 音乐播放器启动器（不依赖Flask）
"""

import sys
import os
import logging

# 确保 stdout 使用 UTF-8 编码（Windows 兼容性）
if sys.stdout.encoding != "utf-8":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

import uvicorn
import configparser

# 导入新的日志配置系统
from models.logging_config import setup_logging


def main():
    """启动 FastAPI 服务器"""
    
    # 初始化日志配置系统（可通过 settings.ini [logging] 部分自定义）
    setup_logging()
    
    # 读取配置文件
    config_file = "settings.ini"
    config = configparser.ConfigParser()
    
    host = "0.0.0.0"
    port = 80
    
    if os.path.exists(config_file):
        try:
            config.read(config_file, encoding="utf-8")
            if config.has_section("app"):
                host = config.get("app", "server_host", fallback="0.0.0.0")
                port = config.getint("app", "server_port", fallback=80)
        except Exception as e:
            print(f"[警告] 无法读取配置文件: {e}")
    
    print(f"\n启动 FastAPI 服务器...")
    print(f"地址: http://{host}:{port}")
    print(f"日志优化: /status 请求采样记录（每10个记录1条）")
    print(f"        stream 相关请求保留完整输出（便于调试）")
    print(f"按 Ctrl+C 停止服务器\n")
    
    # 导入 FastAPI 应用
    from app import app
    
    # 启动 Uvicorn 服务器（支持多并发连接）
    # 使用单一 worker 配合 asyncio 事件循环处理并发
    uvicorn.run(
        app,
        host=host,
        port=port,
        reload=False,
        log_level="info",
        use_colors=False,  # 禁用 ANSI 彩色输出，避免乱码
        # Windows 上不支持多进程 workers，使用 asyncio 单进程处理并发
        limit_concurrency=1024,  # 最大并发连接数
        limit_max_requests=10000,  # 优雅重启机制
        timeout_keep_alive=30,  # 保持连接活跃的超时时间
        access_log=True,  # 启用访问日志（由 RequestLogFilter 过滤）
    )


if __name__ == "__main__":
    main()
