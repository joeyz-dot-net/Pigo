# -*- coding: utf-8 -*-
"""
FastAPI 音乐播放器启动器（不依赖Flask）
"""

import sys
import os
import logging
import subprocess
import threading
import re

# 确保 stdout 使用 UTF-8 编码（Windows 兼容性）
if sys.stdout.encoding != "utf-8":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

import uvicorn
import configparser

# 导入日志模块
from models.logger import setup_logging, logger


def disable_uvicorn_access_logs():
    """禁用 uvicorn 的 HTTP 访问日志，但保留应用日志"""
    access_log = logging.getLogger("uvicorn.access")
    access_log.disabled = True


def get_mpv_audio_devices(mpv_path: str = "mpv") -> list:
    """获取 MPV 支持的 WASAPI 音频设备列表
    
    返回: [(device_id, device_name), ...]
    """
    devices = []
    try:
        # 验证 mpv 可执行文件是否存在
        if not os.path.isfile(mpv_path):
            # 尝试在系统 PATH 中查找
            import shutil
            mpv_in_path = shutil.which('mpv')
            if mpv_in_path:
                print(f"[音频设备检测] 使用系统 PATH 中的 mpv: {mpv_in_path}")
                mpv_path = mpv_in_path
            else:
                print(f"[警告] mpv 可执行文件不存在: {mpv_path}")
                print(f"[提示] 请确保 mpv.exe 位于 bin 目录或系统 PATH 中")
                return devices
        
        result = subprocess.run(
            [mpv_path, "--audio-device=help"],
            capture_output=True,
            text=True,
            timeout=10,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        )
        
        output = result.stdout + result.stderr
        
        # 解析 wasapi 设备
        # 格式: 'wasapi/{guid}' (Device Name)
        pattern = r"'(wasapi/\{[^}]+\})'\s+\(([^)]+)\)"
        matches = re.findall(pattern, output)
        
        for device_id, device_name in matches:
            devices.append((device_id, device_name))
            
    except Exception as e:
        print(f"[警告] 获取音频设备列表失败: {e}")
    
    return devices


def interactive_select_audio_device(mpv_path: str = "mpv", timeout: int = 10) -> str:
    """交互式选择音频输出设备
    
    参数:
        mpv_path: mpv 可执行文件路径
        timeout: 超时时间（秒），超时后使用默认值
    
    返回:
        设备ID (device_id 或 'auto')
    """
    print("\n" + "╔" + "═" * 58 + "╗")
    print("║" + " " * 18 + "🎧 音频输出设备选择" + " " * 18 + "║")
    print("╚" + "═" * 58 + "╝")
    
    devices = get_mpv_audio_devices(mpv_path)
    
    if not devices:
        print("\n❌ 未检测到音频设备，将使用系统默认")
        print("─" * 60)
        return "auto"
    
    # 查找 VB-Cable 设备作为默认选项
    default_choice = 0
    default_name = "系统默认设备"
    for idx, (device_id, device_name) in enumerate(devices, 1):
        if "CABLE Input" in device_name:
            default_choice = idx
            default_name = device_name
            break
    
    # ANSI 颜色码
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    CYAN = '\033[96m'
    BOLD = '\033[1m'
    RESET = '\033[0m'
    
    print(f"\n检测到 {CYAN}{len(devices)}{RESET} 个音频设备:\n")
    
    # 显示选项 [0]
    if default_choice == 0:
        print(f"  {GREEN}{BOLD}► [0] 系统默认设备 (auto) ✓{RESET}")
    else:
        print(f"  [0] 系统默认设备 (auto)")
    
    for idx, (device_id, device_name) in enumerate(devices, 1):
        # 高亮默认选项
        if idx == default_choice:
            print(f"  {GREEN}{BOLD}► [{idx}] {device_name} ✓{RESET}")
            print(f"       {CYAN}设备ID: {device_id}{RESET}")
        else:
            print(f"  [{idx}] {device_name}")
            print(f"       设备ID: {device_id}")
    
    print(f"\n⏱️  {timeout}秒后自动选择默认项: {default_name}{RESET}")
    print("─" * 60)
    
    # 使用线程实现超时输入和倒计时显示
    selected = [None]
    countdown_active = [True]
    
    def show_countdown():
        """显示倒计时"""
        import time
        remaining = timeout
        while remaining > 0 and countdown_active[0] and selected[0] is None:
            time.sleep(1)
            remaining -= 1
    
    def get_input():
        try:
            user_input = input(f"\n请选择 [{default_choice}]: ").strip()
            countdown_active[0] = False
            selected[0] = user_input if user_input else str(default_choice)
        except EOFError:
            countdown_active[0] = False
            selected[0] = str(default_choice)
    
    countdown_thread = threading.Thread(target=show_countdown, daemon=True)
    countdown_thread.start()
    
    input_thread = threading.Thread(target=get_input, daemon=True)
    input_thread.start()
    input_thread.join(timeout=timeout)
    
    # 解析用户选择
    choice = selected[0] if selected[0] is not None else str(default_choice)
    
    try:
        choice_num = int(choice)
        if choice_num == 0:
            GREEN = '\033[92m'
            BOLD = '\033[1m'
            RESET = '\033[0m'
            print(f"\n{GREEN}{BOLD}✅ 已选择: 系统默认设备 (auto){RESET}")
            return "auto"
        elif 1 <= choice_num <= len(devices):
            device_id, device_name = devices[choice_num - 1]
            GREEN = '\033[92m'
            CYAN = '\033[96m'
            BOLD = '\033[1m'
            RESET = '\033[0m'
            print(f"\n{GREEN}{BOLD}✅ 已选择: {device_name}{RESET}")
            print(f"   {CYAN}完整设备ID: {device_id}{RESET}")
            return device_id
        else:
            # 无效选择，使用默认
            if default_choice > 0:
                device_id, device_name = devices[default_choice - 1]
                print(f"\n❌ 无效选择 '{choice}'，使用默认: {device_name}")
                print(f"   完整设备ID: {device_id}")
                return device_id
            else:
                print(f"\n❌ 无效选择 '{choice}'，使用系统默认设备")
                return "auto"
    except ValueError:
        # 解析失败，使用默认
        if default_choice > 0:
            device_id, device_name = devices[default_choice - 1]
            print(f"\n❌ 无效选择 '{choice}'，使用默认: {device_name}")
            print(f"   完整设备ID: {device_id}")
            return device_id
        else:
            print(f"\n❌ 无效选择 '{choice}'，使用系统默认设备")
            return "auto"


def update_mpv_cmd_with_device(config: configparser.ConfigParser, device_id: str) -> str:
    """更新 mpv_cmd 配置，添加音频设备参数
    
    参数:
        config: 配置解析器
        device_id: 设备ID，'auto' 表示使用系统默认
    
    返回:
        更新后的 mpv_cmd
    """
    # 获取主程序目录
    if getattr(sys, 'frozen', False):
        app_dir = os.path.dirname(sys.executable)
    else:
        app_dir = os.path.dirname(os.path.abspath(__file__))
    
    bin_mpv = os.path.join(app_dir, "bin", "mpv.exe")
    
    # 获取现有的 mpv_cmd 配置并展开 ${bin_dir}
    mpv_cmd = config.get("app", "mpv_cmd", fallback="")
    mpv_cmd = mpv_cmd.replace("${bin_dir}", "bin")
    
    # 如果 bin 目录存在 mpv.exe，强制使用它，保留其他参数
    if os.path.exists(bin_mpv):
        if mpv_cmd:
            # 提取现有的参数（去掉可执行文件路径）
            parts = mpv_cmd.split(None, 1)
            params = parts[1] if len(parts) > 1 else "--idle=yes"
        else:
            params = "--idle=yes"
        # 构建新命令，使用 bin 目录的 mpv
        mpv_cmd = f'"{bin_mpv}" {params}'
    elif not mpv_cmd:
        # 如果没有配置且 bin 目录也没有，使用默认值
        mpv_cmd = "mpv --idle=yes"
    
    # 移除现有的 --audio-device 参数
    mpv_cmd = re.sub(r'\s*--audio-device=[^\s]+', '', mpv_cmd)
    
    # 如果不是 auto，添加设备参数
    if device_id != "auto":
        mpv_cmd = mpv_cmd.strip() + f" --audio-device={device_id}"
    
    return mpv_cmd


def cleanup_on_exit():
    """程序退出时的清理函数"""
    try:
        import subprocess
        # 强制终止所有 MPV 进程
        subprocess.run(["taskkill", "/IM", "mpv.exe", "/F"], capture_output=True, timeout=2)
        print("\n✅ MPV 进程已清理")
    except:
        pass


def interactive_select_streaming_mode(timeout: int = 10) -> bool:
    """交互式选择是否启用 WebRTC 推流模式
    
    参数:
        timeout: 超时时间（秒），超时后使用默认值（启用推流）
    
    返回:
        True 启用推流，False 禁用推流
    """
    print("\n" + "╔" + "═" * 58 + "╗")
    print("║" + " " * 19 + "🎙️  推流模式选择" + " " * 20 + "║")
    print("╚" + "═" * 58 + "╝")
    
    # ANSI 颜色码
    GREEN = '\033[92m'
    CYAN = '\033[96m'
    BOLD = '\033[1m'
    RESET = '\033[0m'
    
    print("\n请选择音频输出模式:\n")
    print(f"  [1] 仅本地播放 - 播放到本机音频设备")
    print(f"      直接播放，无网络延迟")
    print("")
    print(f"  {GREEN}{BOLD}► [2] 启用推流 - 通过 WebRTC 推流到浏览器 ✓{RESET}")
    print(f"       {CYAN}✓ 支持远程浏览器播放{RESET}")
    print(f"\n⏱️  {timeout}秒后自动选择: 启用推流{RESET}")
    print("─" * 60)
    
    # 使用线程实现超时输入
    selected = [None]
    countdown_active = [True]
    
    def show_countdown():
        import time
        remaining = timeout
        while remaining > 0 and countdown_active[0] and selected[0] is None:
            time.sleep(1)
            remaining -= 1
    
    def get_input():
        try:
            user_input = input(f"\n请选择 [2]: ").strip()
            countdown_active[0] = False
            selected[0] = user_input if user_input else "2"
        except EOFError:
            countdown_active[0] = False
            selected[0] = "2"
    
    countdown_thread = threading.Thread(target=show_countdown, daemon=True)
    countdown_thread.start()
    
    input_thread = threading.Thread(target=get_input, daemon=True)
    input_thread.start()
    input_thread.join(timeout=timeout)
    
    # 解析用户选择
    choice = selected[0] if selected[0] is not None else "2"
    
    try:
        choice_num = int(choice)
        if choice_num == 2:
            print(f"\n{GREEN}{BOLD}✅ 已选择: 启用推流模式{RESET}")
            print(f"   {CYAN}将初始化 WebRTC 推流模块{RESET}")
            return True
        else:
            print(f"\n{GREEN}{BOLD}✅ 已选择: 仅本地播放{RESET}")
            print(f"   {CYAN}不初始化推流模块，节省资源{RESET}")
            return False
    except ValueError:
        print(f"\n❌ 无效选择 '{choice}'，使用默认: 启用推流")
        return True


def main():
    """启动 FastAPI 服务器"""
    import sys
    import io
    import os
    import configparser
    import threading
    import re
    import signal
    import atexit
    from pathlib import Path
    
    # 注册退出时清理函数
    atexit.register(cleanup_on_exit)
    
    # 处理 Ctrl+C 信号
    def signal_handler(sig, frame):
        print("\n\n⚠️  收到中断信号，正在清理...")
        cleanup_on_exit()
        # 使用 os._exit(0) 避免 SystemExit 异常导致的 traceback
        import os
        os._exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    if hasattr(signal, 'SIGTERM'):
        signal.signal(signal.SIGTERM, signal_handler)
    
    # 确保 stdout 使用 UTF-8 编码（Windows 兼容性）
    if sys.stdout.encoding != "utf-8":
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    
    # 导入日志模块
    from models.logger import setup_logging, logger
    
    # 设置日志
    setup_logging()
    
    # 禁用 uvicorn 访问日志
    disable_uvicorn_access_logs()
    
    print("\n" + "=" * 60)
    print("🎵 音乐播放器启动中...")
    print("=" * 60)
    
    # 加载配置文件
    config = configparser.ConfigParser()
    config_file = Path("settings.ini")
    if config_file.exists():
        config.read(config_file, encoding="utf-8")
    
    # 【第一步】交互式选择音频设备（默认VB-Cable）
    # 获取主程序目录
    if getattr(sys, 'frozen', False):
        app_dir = os.path.dirname(sys.executable)
    else:
        app_dir = os.path.dirname(os.path.abspath(__file__))
    
    bin_dir = os.path.join(app_dir, "bin")
    bin_mpv = os.path.join(bin_dir, "mpv.exe")
    
    logger.info(f"主程序目录: {app_dir}")
    logger.info(f"检查 MPV 路径: {bin_mpv}")
    
    # 确定实际使用的 mpv 路径（优先使用 bin 目录）
    if os.path.exists(bin_mpv):
        mpv_path = bin_mpv
        logger.info(f"✓ 找到 MPV: {bin_mpv}")
    else:
        # 尝试系统 PATH
        import shutil
        mpv_in_path = shutil.which('mpv')
        if mpv_in_path:
            mpv_path = mpv_in_path
            logger.info(f"✓ 使用系统 PATH 中的 MPV: {mpv_in_path}")
        else:
            logger.warning(f"✗ 未找到 MPV 可执行文件")
            logger.warning(f"  - 检查路径: {bin_mpv}")
            logger.warning(f"  - 系统 PATH 也未找到")
            mpv_path = "mpv"  # 使用默认值，让后续代码处理
    
    selected_device = interactive_select_audio_device(mpv_path=mpv_path, timeout=10)
    
    # 更新 mpv_cmd 配置
    if not config.has_section("app"):
        config.add_section("app")
    
    new_mpv_cmd = update_mpv_cmd_with_device(config, selected_device)
    config.set("app", "mpv_cmd", new_mpv_cmd)
    print(f"\n[配置] MPV 命令已更新")
    
    if selected_device != "auto":
        os.environ["MPV_AUDIO_DEVICE"] = selected_device
    
    # 【第二步】交互式选择是否启用推流
    enable_streaming = interactive_select_streaming_mode(timeout=10)
    os.environ["ENABLE_STREAMING"] = "true" if enable_streaming else "false"
    
    # 显示完整设备名称和设备ID
    device_display = '系统默认 (auto)'
    device_id_display = 'N/A'
    
    if selected_device != 'auto':
        # 尝试获取完整设备名称
        devices = get_mpv_audio_devices(mpv_path)
        for device_id, device_name in devices:
            if device_id == selected_device:
                device_display = device_name
                device_id_display = device_id
                break
        # 如果没找到对应设备名称，直接显示设备ID
        if device_id_display == 'N/A':
            device_display = selected_device
            device_id_display = selected_device
    
    print("\n" + "=" * 60)
    print("✅ 启动配置完成")
    print("=" * 60)
    print(f"\n   🎧 音频设备:")
    print(f"      名称: {device_display}")
    if selected_device != 'auto':
        print(f"      设备ID: {device_id_display}")
    print(f"\n   🎙️  推流模式: {'启用 ✅' if enable_streaming else '禁用 ❌'}")
    print("\n" + "=" * 60 + "\n")
    
    # 导入 FastAPI 应用实例
    from app import app as fastapi_app
    
    # 启动 FastAPI 服务器
    import uvicorn
    
    server_host = config.get("app", "server_host", fallback="0.0.0.0")
    server_port = config.getint("app", "server_port", fallback=80)
    
    uvicorn.run(
        fastapi_app,
        host=server_host,
        port=server_port,
        reload=False,  # 禁用自动重载（settings.ini 需要手动重启）
        log_config=None,  # 使用自定义日志配置
        access_log=False  # 禁用访问日志（避免高频 /status 轮询刷屏）
    )


if __name__ == "__main__":
    main()
