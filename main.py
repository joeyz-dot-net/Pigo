# -*- coding: utf-8 -*-
"""
ClubMusic 启动器
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
    
    # 查找 VB-Cable 设备作为默认选项（优先选择 CABLE-A）
    default_choice = 0
    default_name = "系统默认设备"
    for idx, (device_id, device_name) in enumerate(devices, 1):
        if "CABLE-A Input" in device_name:
            default_choice = idx
            default_name = device_name
            break
    
    # 如果没找到 CABLE-A，回退到普通 CABLE Input
    if default_choice == 0:
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
    print(f"   💡 按任意键取消倒计时，继续等待输入")
    print("─" * 60)
    
    # Windows 下使用 msvcrt 实现非阻塞按键检测
    import time
    if os.name == 'nt':
        import msvcrt
        
        print(f"\n请选择 [{default_choice}]: ", end="", flush=True)
        
        input_chars = []
        start_time = time.time()
        countdown_cancelled = False
        
        while True:
            elapsed = time.time() - start_time
            
            # 检查是否有按键
            if msvcrt.kbhit():
                char = msvcrt.getwch()
                
                # 如果还在倒计时中，任意按键取消倒计时
                if not countdown_cancelled and elapsed < timeout:
                    countdown_cancelled = True
                    print(f"\n   ⏹️  倒计时已取消，请继续输入...")
                    print(f"\n请选择 [{default_choice}]: ", end="", flush=True)
                
                if char == '\r':  # Enter 键
                    print()  # 换行
                    break
                elif char == '\x03':  # Ctrl+C
                    raise KeyboardInterrupt
                elif char == '\x08':  # Backspace
                    if input_chars:
                        input_chars.pop()
                        # 清除屏幕上的字符
                        print('\b \b', end="", flush=True)
                else:
                    input_chars.append(char)
                    print(char, end="", flush=True)
            
            # 超时检查（仅在未取消倒计时时生效）
            if not countdown_cancelled and elapsed >= timeout:
                print()  # 换行
                break
            
            time.sleep(0.05)  # 避免 CPU 占用过高
        
        user_input = ''.join(input_chars).strip()
        choice = user_input if user_input else str(default_choice)
    else:
        # 非 Windows 系统使用原来的线程方式
        selected = [None]
        countdown_active = [True]
        
        def get_input():
            try:
                user_input = input(f"\n请选择 [{default_choice}]: ").strip()
                countdown_active[0] = False
                selected[0] = user_input if user_input else str(default_choice)
            except EOFError:
                countdown_active[0] = False
                selected[0] = str(default_choice)
        
        input_thread = threading.Thread(target=get_input, daemon=True)
        input_thread.start()
        input_thread.join(timeout=timeout)
        
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


def get_sounddevice_input_devices() -> list:
    """获取 sounddevice 支持的音频输入设备列表（用于 WebRTC 采集）
    
    返回: [(device_index, device_name, channels), ...]
    """
    devices = []
    try:
        import sounddevice as sd
        all_devices = sd.query_devices()
        
        for i, dev in enumerate(all_devices):
            name = dev.get('name', '')
            max_input_channels = dev.get('max_input_channels', 0)
            
            # 只列出输入设备
            if max_input_channels > 0:
                devices.append((i, name, max_input_channels))
                
    except ImportError:
        print("[警告] sounddevice 未安装，无法获取音频输入设备列表")
    except Exception as e:
        print(f"[警告] 获取音频输入设备列表失败: {e}")
    
    return devices


def interactive_select_webrtc_device(timeout: int = 10) -> tuple:
    """交互式选择 WebRTC 音频采集设备
    
    返回:
        元组 (device_name, device_index) 或 ("", -1) 如果未选择
    
    参数:
        timeout: 超时时间（秒），超时后使用默认值
    
    返回:
        设备名称
    """
    print("\n" + "╔" + "═" * 58 + "╗")
    print("║" + " " * 16 + "🎙️  WebRTC 音频采集设备选择" + " " * 14 + "║")
    print("╚" + "═" * 58 + "╝")
    
    devices = get_sounddevice_input_devices()
    
    if not devices:
        print("\n❌ 未检测到音频输入设备")
        print("─" * 60)
        return ""
    
    # 查找 VB-Cable 设备作为默认选项（优先选择 2 通道版本）
    default_choice = 0
    default_name = "无默认"
    
    # 优先查找 CABLE-A Output 2通道版本
    for idx, (dev_idx, dev_name, channels) in enumerate(devices):
        if "CABLE" in dev_name and "Output" in dev_name and channels == 2:
            default_choice = idx + 1
            default_name = dev_name
            break
    
    # 如果没找到 2 通道的，找任意 CABLE Output
    if default_choice == 0:
        for idx, (dev_idx, dev_name, channels) in enumerate(devices):
            if "CABLE" in dev_name and "Output" in dev_name:
                default_choice = idx + 1
                default_name = dev_name
                break
    
    # ANSI 颜色码
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    CYAN = '\033[96m'
    BOLD = '\033[1m'
    RESET = '\033[0m'
    
    print(f"\n检测到 {CYAN}{len(devices)}{RESET} 个音频输入设备:\n")
    
    for idx, (dev_idx, dev_name, channels) in enumerate(devices, 1):
        # 高亮默认选项和 CABLE 设备
        if idx == default_choice:
            print(f"  {GREEN}{BOLD}► [{idx}] {dev_name} ({channels}ch) ✓{RESET}")
        elif "CABLE" in dev_name:
            print(f"  {YELLOW}[{idx}] {dev_name} ({channels}ch){RESET}")
        else:
            print(f"  [{idx}] {dev_name} ({channels}ch)")
    
    if default_choice > 0:
        print(f"\n⏱️  {timeout}秒后自动选择默认项: {default_name}")
    else:
        print(f"\n⏱️  {timeout}秒后自动选择第一个设备")
        default_choice = 1
        default_name = devices[0][1]
    
    print(f"   💡 按任意键取消倒计时，继续等待输入")
    print("─" * 60)
    
    # Windows 下使用 msvcrt 实现非阻塞按键检测
    import time
    if os.name == 'nt':
        import msvcrt
        
        print(f"\n请选择 [{default_choice}]: ", end="", flush=True)
        
        input_chars = []
        start_time = time.time()
        countdown_cancelled = False
        
        while True:
            elapsed = time.time() - start_time
            
            # 检查是否有按键
            if msvcrt.kbhit():
                char = msvcrt.getwch()
                
                # 如果还在倒计时中，任意按键取消倒计时
                if not countdown_cancelled and elapsed < timeout:
                    countdown_cancelled = True
                    print(f"\n   ⏹️  倒计时已取消，请继续输入...")
                    print(f"\n请选择 [{default_choice}]: ", end="", flush=True)
                
                if char == '\r':  # Enter 键
                    print()  # 换行
                    break
                elif char == '\x03':  # Ctrl+C
                    raise KeyboardInterrupt
                elif char == '\x08':  # Backspace
                    if input_chars:
                        input_chars.pop()
                        print('\b \b', end="", flush=True)
                else:
                    input_chars.append(char)
                    print(char, end="", flush=True)
            
            # 超时检查
            if not countdown_cancelled and elapsed >= timeout:
                print()
                break
            
            time.sleep(0.05)
        
        user_input = ''.join(input_chars).strip()
        choice = user_input if user_input else str(default_choice)
    else:
        # 非 Windows 系统
        selected = [None]
        
        def get_input():
            try:
                user_input = input(f"\n请选择 [{default_choice}]: ").strip()
                selected[0] = user_input if user_input else str(default_choice)
            except EOFError:
                selected[0] = str(default_choice)
        
        input_thread = threading.Thread(target=get_input, daemon=True)
        input_thread.start()
        input_thread.join(timeout=timeout)
        
        choice = selected[0] if selected[0] is not None else str(default_choice)
    
    try:
        choice_num = int(choice)
        if 1 <= choice_num <= len(devices):
            dev_idx, dev_name, channels = devices[choice_num - 1]
            print(f"\n{GREEN}{BOLD}✅ 已选择: {dev_name} ({channels}ch){RESET}")
            return (dev_name, dev_idx)  # 返回元组 (名称, 索引)
        else:
            # 无效选择，使用默认
            dev_idx, dev_name, channels = devices[default_choice - 1]
            print(f"\n❌ 无效选择 '{choice}'，使用默认: {dev_name}")
            return (dev_name, dev_idx)
    except ValueError:
        # 解析失败，使用默认
        dev_idx, dev_name, channels = devices[default_choice - 1]
        print(f"\n❌ 无效选择 '{choice}'，使用默认: {dev_name}")
        return (dev_name, dev_idx)


def interactive_select_webrtc_quality(timeout: int = 15) -> dict:
    """交互式选择 WebRTC 音质配置
    
    返回:
        音质配置字典 {sample_rate, channels, blocksize, bitrate_kbps, profile_name}
    """
    print("\n" + "╔" + "═" * 58 + "╗")
    print("║" + " " * 16 + "🎵 WebRTC 音质配置选择" + " " * 16 + "║")
    print("╚" + "═" * 58 + "╝")
    
    # 预设音质配置
    quality_profiles = [
        {
            "id": 1,
            "name": "🎧 高音质 (推荐)",
            "sample_rate": 48000,
            "channels": 2,
            "blocksize": 960,  # 优化: 改为960样本(20ms)，减少延迟和卡顿
            "bitrate_kbps": 256,
            "description": "48kHz 立体声, 256kbps, 20ms延迟 - 最佳音质"
        },
        {
            "id": 2,
            "name": "⚡ 低延迟",
            "sample_rate": 48000,
            "channels": 2,
            "blocksize": 480,  # 极低延迟: 10ms
            "bitrate_kbps": 192,
            "description": "48kHz 立体声, 192kbps, 10ms延迟 - 极速响应"
        },
        {
            "id": 3,
            "name": "💾 省带宽",
            "sample_rate": 44100,
            "channels": 2,
            "blocksize": 882,  # 44.1kHz下的约20ms
            "bitrate_kbps": 128,
            "description": "44.1kHz 立体声, 128kbps, 20ms延迟 - 节省带宽"
        },
        {
            "id": 4,
            "name": "🔊 超高音质 (实验)",
            "sample_rate": 96000,
            "channels": 2,
            "blocksize": 1920,  # 96kHz下的约20ms
            "bitrate_kbps": 384,
            "description": "96kHz 立体声, 384kbps, 20ms延迟 - 发烧级"
        },
        {
            "id": 5,
            "name": "📻 单声道",
            "sample_rate": 48000,
            "channels": 1,
            "blocksize": 960,
            "bitrate_kbps": 128,
            "description": "48kHz 单声道, 128kbps, 20ms - 语音优化"
        }
    ]
    
    # 默认选择（高音质）
    default_choice = 1
    
    # ANSI 颜色码
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    CYAN = '\033[96m'
    BOLD = '\033[1m'
    RESET = '\033[0m'
    
    print(f"\n可选音质配置:\n")
    
    for profile in quality_profiles:
        if profile["id"] == default_choice:
            print(f"  {GREEN}{BOLD}► [{profile['id']}] {profile['name']} ✓{RESET}")
            print(f"       {CYAN}{profile['description']}{RESET}")
        else:
            print(f"  [{profile['id']}] {profile['name']}")
            print(f"       {profile['description']}")
        print()
    
    default_profile = quality_profiles[default_choice - 1]
    print(f"⏱️  {timeout}秒后自动选择默认项: {default_profile['name']}")
    print(f"   💡 按任意键取消倒计时，继续等待输入")
    print("─" * 60)
    
    import time
    if os.name == 'nt':
        import msvcrt
        
        print(f"\n请选择 [{default_choice}]: ", end="", flush=True)
        
        input_chars = []
        start_time = time.time()
        countdown_cancelled = False
        
        while True:
            elapsed = time.time() - start_time
            
            if msvcrt.kbhit():
                char = msvcrt.getwch()
                
                if not countdown_cancelled and elapsed < timeout:
                    countdown_cancelled = True
                    print(f"\n   ⏹️  倒计时已取消，请继续输入...")
                    print(f"\n请选择 [{default_choice}]: ", end="", flush=True)
                
                if char == '\r':
                    print()
                    break
                elif char == '\x03':
                    raise KeyboardInterrupt
                elif char == '\x08':
                    if input_chars:
                        input_chars.pop()
                        print('\b \b', end="", flush=True)
                else:
                    input_chars.append(char)
                    print(char, end="", flush=True)
            
            if not countdown_cancelled and elapsed >= timeout:
                print()
                break
            
            time.sleep(0.05)
        
        user_input = ''.join(input_chars).strip()
        choice = user_input if user_input else str(default_choice)
    else:
        # 非 Windows 系统
        selected = [None]
        
        def get_input():
            try:
                user_input = input(f"\n请选择 [{default_choice}]: ").strip()
                selected[0] = user_input if user_input else str(default_choice)
            except EOFError:
                selected[0] = str(default_choice)
        
        input_thread = threading.Thread(target=get_input, daemon=True)
        input_thread.start()
        input_thread.join(timeout=timeout)
        
        choice = selected[0] if selected[0] is not None else str(default_choice)
    
    try:
        choice_num = int(choice)
        if 1 <= choice_num <= len(quality_profiles):
            selected_profile = quality_profiles[choice_num - 1]
            print(f"\n{GREEN}{BOLD}✅ 已选择: {selected_profile['name']}{RESET}")
            print(f"   {CYAN}配置: {selected_profile['description']}{RESET}")
            return selected_profile
        else:
            print(f"\n❌ 无效选择 '{choice}'，使用默认配置")
            return default_profile
    except ValueError:
        print(f"\n❌ 无效选择 '{choice}'，使用默认配置")
        return default_profile


def cleanup_on_exit():
    """程序退出时的清理函数"""
    try:
        import subprocess
        # 强制终止所有 MPV 进程
        subprocess.run(["taskkill", "/IM", "mpv.exe", "/F"], capture_output=True, timeout=2)
        print("\n✅ MPV 进程已清理")
    except:
        pass


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
    print("🎵 ClubMusic 启动中...")
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
    
    # 从配置文件读取启动超时时间
    startup_timeout = config.getint("app", "startup_timeout", fallback=10)
    selected_device = interactive_select_audio_device(mpv_path=mpv_path, timeout=startup_timeout)
    
    # 更新 mpv_cmd 配置
    if not config.has_section("app"):
        config.add_section("app")
    
    new_mpv_cmd = update_mpv_cmd_with_device(config, selected_device)
    config.set("app", "mpv_cmd", new_mpv_cmd)
    print(f"\n[配置] MPV 命令已更新")
    
    if selected_device != "auto":
        os.environ["MPV_AUDIO_DEVICE"] = selected_device
    
    # 【第二步】从配置文件读取推流开关（取消交互选择）
    enable_streaming = config.getboolean("app", "enable_stream", fallback=True)
    os.environ["ENABLE_STREAMING"] = "true" if enable_streaming else "false"
    print(f"\n[配置] 推流模式: {'启用 ✅' if enable_streaming else '禁用 ❌'} (读取自 settings.ini)")
    
    # 【第三步】如果启用推流，选择 WebRTC 音频采集设备
    webrtc_device_name = ""
    webrtc_device_index = -1
    webrtc_quality_config = {}
    if enable_streaming:
        result = interactive_select_webrtc_device(timeout=startup_timeout)
        if result and result[0]:
            webrtc_device_name, webrtc_device_index = result
            os.environ["WEBRTC_AUDIO_DEVICE"] = webrtc_device_name
            os.environ["WEBRTC_AUDIO_DEVICE_INDEX"] = str(webrtc_device_index)
        else:
            print("\n⚠️  未选择 WebRTC 音频设备，推流可能无法正常工作")
        
        # 【第四步】选择 WebRTC 音质配置
        webrtc_quality_config = interactive_select_webrtc_quality(timeout=startup_timeout)
        if webrtc_quality_config:
            os.environ["WEBRTC_SAMPLE_RATE"] = str(webrtc_quality_config["sample_rate"])
            os.environ["WEBRTC_CHANNELS"] = str(webrtc_quality_config["channels"])
            os.environ["WEBRTC_BLOCKSIZE"] = str(webrtc_quality_config["blocksize"])
            os.environ["WEBRTC_BITRATE_KBPS"] = str(webrtc_quality_config["bitrate_kbps"])
            os.environ["WEBRTC_PROFILE_NAME"] = webrtc_quality_config["name"]
    
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
    if enable_streaming and webrtc_device_name:
        print(f"      采集设备: {webrtc_device_name}")
    if enable_streaming and webrtc_quality_config:
        print(f"\n   🎵 音质配置: {webrtc_quality_config['name']}")
        print(f"      采样率: {webrtc_quality_config['sample_rate']} Hz")
        print(f"      声道: {webrtc_quality_config['channels']} ({'立体声' if webrtc_quality_config['channels'] == 2 else '单声道'})")
        print(f"      块大小: {webrtc_quality_config['blocksize']} 样本 ({webrtc_quality_config['blocksize'] * 1000 / webrtc_quality_config['sample_rate']:.1f}ms)")
        print(f"      目标码率: {webrtc_quality_config['bitrate_kbps']} kbps")
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
