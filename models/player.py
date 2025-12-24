# -*- coding: utf-8 -*-
import sys
import os

# 确保 stdout 使用 UTF-8 编码（Windows 兼容性）
if sys.stdout and sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    except Exception:
        pass

"""
音乐播放器主类
"""

import json
import threading
import time
import configparser
import subprocess
import re
import logging
from models import Song, LocalSong, StreamSong, Playlist, PlayHistory

logger = logging.getLogger(__name__)


class MusicPlayer:
    """音乐播放器类 - 包含所有播放器配置和状态"""

    # 默认配置常量
    DEFAULT_CONFIG = {
        "MUSIC_DIR": "Z:",
        "ALLOWED_EXTENSIONS": ".mp3,.wav,.flac",
        "SERVER_HOST": "0.0.0.0",
        "SERVER_PORT": "80",
        "DEBUG": "false",
        "MPV_CMD": r'bin\mpv.exe --input-ipc-server=\\.\pipe\mpv-pipe --idle=yes --force-window=no --ao=dshow --audio-device="CABLE Output (VB-Audio Virtual Cable)"',
        "LOCAL_SEARCH_MAX_RESULTS": "20",
        "YOUTUBE_SEARCH_MAX_RESULTS": "20",
        "LOCAL_VOLUME": "50",
        "STREAM_VOLUME": "50",
    }

    @staticmethod
    def _get_app_dir():
        """获取应用程序目录（主程序目录）
        
        支持两种情况：
        1. 开发环境：从 models/player.py 推导到主程序目录
        2. PyInstaller 打包后的 exe：使用 exe 文件所在目录作为主程序目录
        """
        if getattr(sys, 'frozen', False):
            # 打包后的 exe：使用 exe 文件所在目录
            return os.path.dirname(sys.executable)
        else:
            # 开发环境：从 models/player.py 推导到主程序目录
            return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    @staticmethod
    def _normalize_mpv_cmd(mpv_cmd: str, app_dir: str = None) -> str:
        """规范化 MPV 命令中的相对路径为绝对路径
        
        参数:
          mpv_cmd: 原始MPV命令
          app_dir: 应用程序目录（为None时自动获取）
        
        返回:
          规范化后的MPV命令
        """
        if not mpv_cmd:
            return mpv_cmd
        
        if app_dir is None:
            app_dir = MusicPlayer._get_app_dir()
        
        # 简单的路径提取：只处理第一个词（MPV可执行文件路径）
        parts = mpv_cmd.split(None, 1)  # 按第一个空白符分割成两部分
        if not parts:
            return mpv_cmd
        
        exe_path = parts[0].strip('"\'')
        
        # 如果是相对路径，转换为绝对路径
        if not os.path.isabs(exe_path):
            abs_exe_path = os.path.join(app_dir, exe_path)
            if os.path.exists(abs_exe_path):
                # 如果路径包含空格，需要加引号
                if ' ' in abs_exe_path:
                    normalized_exe = f'"{abs_exe_path}"'
                else:
                    normalized_exe = abs_exe_path
                
                # 重新组合命令
                if len(parts) > 1:
                    return normalized_exe + ' ' + parts[1]
                else:
                    return normalized_exe
        
        return mpv_cmd

    @staticmethod
    def _get_default_mpv_cmd():
        """获取默认的 MPV 命令"""
        app_dir = MusicPlayer._get_app_dir()
        
        # 主程序目录下的 bin 子目录中的 mpv.exe 路径
        mpv_path = os.path.join(app_dir, "bin", "mpv.exe")
        return (
            f'"{mpv_path}" '
            "--input-ipc-server=\\\\.\\\pipe\\\\mpv-pipe "
            "--idle=yes --force-window=no "
            '--ao=dshow --audio-device="CABLE Output (VB-Audio Virtual Cable)"'
        )

    @staticmethod
    def _get_default_ini_path():
        """获取默认配置文件路径"""
        return os.path.join(MusicPlayer._get_app_dir(), "settings.ini")

    @staticmethod
    def ensure_ini_exists(ini_path: str = None):
        """确保INI配置文件存在，不存在则创建默认配置

        参数:
          ini_path: 配置文件路径，为None时使用默认路径
        """
        if ini_path is None:
            ini_path = MusicPlayer._get_default_ini_path()

        logger.debug(f"配置文件路径: {ini_path}")
        if os.path.exists(ini_path):
            logger.debug(f"配置文件已存在，跳过创建")
            return

        logger.info(f"配置文件不存在，创建默认配置...")
        # 使用默认配置（包括默认的 MPV 命令）
        default_cfg = MusicPlayer.DEFAULT_CONFIG.copy()

        logger.debug(f"默认配置内容:")
        for key, value in default_cfg.items():
            if key == "MPV_CMD":
                logger.debug(f" {key}: {value}")
            else:
                logger.debug(f" {key}: {value}")
        parser = configparser.ConfigParser()
        parser["app"] = default_cfg
        with open(ini_path, "w", encoding="utf-8") as w:
            parser.write(w)
        logger.info(f"已生成默认配置文件: {ini_path}")

    def __init__(
        self,
        music_dir="Z:",
        allowed_extensions=".mp3,.wav,.flac",
        server_host="0.0.0.0",
        server_port=80,
        debug=False,
        mpv_cmd=None,
        data_dir=".",
        local_search_max_results=20,
        youtube_search_max_results=10,
    ):
        """
        初始化音乐播放器

        参数:
          music_dir: 音乐库目录路径
          allowed_extensions: 允许的文件扩展名（逗号分隔）
          server_host: FastAPI 服务器主机
          server_port: FastAPI 服务器端口
          debug: 是否启用调试模式
          mpv_cmd: mpv 命令行
          data_dir: 数据文件存储目录
          local_search_max_results: 本地搜索最大结果数
          youtube_search_max_results: YouTube搜索最大结果数
        """
        # 配置属性
        self.music_dir = self._normalize_music_dir(music_dir)
        self.allowed_extensions = self._parse_extensions(allowed_extensions)
        self.server_host = server_host
        self.server_port = int(server_port)
        self.debug = debug
        self.local_search_max_results = int(local_search_max_results)
        self.youtube_search_max_results = int(youtube_search_max_results)
        # 使用类方法避免实例绑定问题
        self.mpv_cmd = mpv_cmd or MusicPlayer._get_default_mpv_cmd()
        # 规范化 MPV 命令中的相对路径
        self.mpv_cmd = MusicPlayer._normalize_mpv_cmd(self.mpv_cmd)
        self.data_dir = data_dir
        
        # 向后兼容性：提供 flask_host 和 flask_port 别名（已弃用）
        self.flask_host = server_host
        self.flask_port = int(server_port)

        # 确保数据目录存在
        if not os.path.exists(self.data_dir):
            os.makedirs(self.data_dir, exist_ok=True)

        # 文件路径
        self.playback_history_file = os.path.join(
            self.data_dir, "playback_history.json"
        )
        self.current_playlist_file = os.path.join(self.data_dir, "playlist.json")

        # 播放器状态
        self.playlist = []  # 存储相对路径
        self.current_index = -1
        self.current_meta = {}
        self.loop_mode = 0  # 0=不循环, 1=单曲循环, 2=全部循环
        self._last_play_time = 0
        self._prev_index = None
        self._prev_meta = None

        # 自动播放线程
        self._auto_thread = None
        self._stop_flag = False
        self._req_id = 0

        # 播放管道名称（用于与mpv通信）
        self.pipe_name = None
        
        # MPV 进程对象
        self.mpv_process = None

        # 播放历史 - 使用 PlayHistory 类
        self.playback_history_file = os.path.join(
            self.data_dir, "playback_history.json"
        )
        self.playback_history = PlayHistory(
            max_size=50, file_path=self.playback_history_file
        )
        self.playback_history_max = 50  # 保留以保持兼容性

        # 播放队列
        from models import CurrentPlaylist
        self.current_playlist = CurrentPlaylist()
        self.current_playlist_file = os.path.join(self.data_dir, "playlist.json")

        # 线程锁
        self._lock = threading.RLock()

        # 加载持久化数据
        self.load_playback_history()
        logger.debug('调用 load_current_playlist 前，current_playlist 类型:', type(self.current_playlist))
        self.load_current_playlist()
        logger.debug('调用 load_current_playlist 后，current_playlist 类型:', type(self.current_playlist))

        # 构建本地文件树
        try:
            self.local_file_tree = self.build_tree()
        except Exception as e:
            logger.warning(f"构建文件树失败: {e}")
            self.local_file_tree = {"name": "根目录", "rel": "", "dirs": [], "files": []}

        # 初始化 MPV IPC（只加载一次）
        self._init_mpv_ipc()

        logger.info(f"播放器初始化完成: music_dir={self.music_dir}, extensions={self.allowed_extensions}")

    @classmethod
    def initialize(cls, data_dir: str = "."):
        """初始化播放器 - 确保配置文件存在，然后创建并返回播放器实例

        这是在主程序中调用的单一入口点，处理所有初始化逻辑

        参数:
          data_dir: 数据文件存储目录

        返回:
          已初始化的 MusicPlayer 实例
        """
        # 确保配置文件存在
        ini_path = cls._get_default_ini_path()
        cls.ensure_ini_exists(ini_path)

        # 从配置文件创建播放器实例
        player = cls.from_ini_file(ini_path, data_dir=data_dir)

        logger.info("播放器已初始化，所有模块就绪")
        return player

    @classmethod
    def from_ini_file(cls, ini_path: str, data_dir: str = "."):
        """从INI配置文件创建播放器实例

        参数:
          ini_path: 配置文件路径
          data_dir: 数据文件存储目录

        返回:
          MusicPlayer 实例
        """
        logger.info(f"开始加载配置文件")
        logger.debug(f"配置文件路径: {ini_path}")
        cfg = cls._read_ini_file(ini_path)
        app_dir = MusicPlayer._get_app_dir()
        
        logger.debug(f"解析后的配置内容:")
        for key, value in cfg.items():
            if key == "MPV_CMD":
                logger.debug(f" {key}: {value[:60]}..." if value and len(str(value)) > 60 else f"  {key}: {value}")
            else:
                logger.debug(f" {key}: {value}")
        
        # 提取配置参数
        music_dir = cfg.get("MUSIC_DIR", cls.DEFAULT_CONFIG["MUSIC_DIR"])
        allowed_ext = cfg.get(
            "ALLOWED_EXTENSIONS", cls.DEFAULT_CONFIG["ALLOWED_EXTENSIONS"]
        )
        server_host = cfg.get("SERVER_HOST", cls.DEFAULT_CONFIG["SERVER_HOST"])
        server_port_str = cfg.get("SERVER_PORT", cls.DEFAULT_CONFIG["SERVER_PORT"])
        debug_str = cfg.get("DEBUG", cls.DEFAULT_CONFIG["DEBUG"])
        debug_flag = debug_str.lower() in ("true", "1", "yes")
        mpv_cmd = cfg.get("MPV_CMD")
        
        # 规范化 MPV 命令中的相对路径
        if mpv_cmd:
            mpv_cmd = cls._normalize_mpv_cmd(mpv_cmd, app_dir)
        
        logger.info(f"配置参数摘要:")
        logger.info(f" MUSIC_DIR: {music_dir}")
        logger.info(f" ALLOWED_EXTENSIONS: {allowed_ext}")
        logger.info(f" SERVER_HOST: {server_host}")
        logger.info(f" SERVER_PORT: {server_port_str}")
        logger.info(f" DEBUG: {debug_flag} (原始值: {debug_str})")
        logger.info(f" MPV_CMD: {'已配置' if mpv_cmd else '使用默认'}")
        
        local_search_max = cfg.get("LOCAL_SEARCH_MAX_RESULTS", cls.DEFAULT_CONFIG["LOCAL_SEARCH_MAX_RESULTS"])
        youtube_search_max = cfg.get("YOUTUBE_SEARCH_MAX_RESULTS", cls.DEFAULT_CONFIG["YOUTUBE_SEARCH_MAX_RESULTS"])
        logger.info(f"  LOCAL_SEARCH_MAX_RESULTS: {local_search_max}")
        logger.info(f"  YOUTUBE_SEARCH_MAX_RESULTS: {youtube_search_max}")
        logger.info(f"===== 配置加载完成 =====\n")
        
        player = cls(
            music_dir=music_dir,
            allowed_extensions=allowed_ext,
            server_host=server_host,
            server_port=int(server_port_str),
            debug=debug_flag,
            mpv_cmd=mpv_cmd,
            data_dir=data_dir,
            local_search_max_results=local_search_max,
            youtube_search_max_results=youtube_search_max,
        )
        
        # 保存完整配置供后续使用（路径、FFmpeg参数等）
        player.config = cfg
        
        return player

    @classmethod
    def from_json_file(cls, json_path: str, data_dir: str = "."):
        """从JSON配置文件创建播放器实例

        参数:
          json_path: 配置文件路径
          data_dir: 数据文件存储目录

        返回:
          MusicPlayer 实例
        """
        cfg = cls._read_json_file(json_path)
        return cls(
            music_dir=cfg.get("music_dir", cls.DEFAULT_CONFIG["MUSIC_DIR"]),
            allowed_extensions=cfg.get(
                "allowed_extensions", cls.DEFAULT_CONFIG["ALLOWED_EXTENSIONS"]
            ),
            flask_host=cfg.get("flask_host", cls.DEFAULT_CONFIG["FLASK_HOST"]),
            flask_port=int(cfg.get("flask_port", cls.DEFAULT_CONFIG["FLASK_PORT"])),
            debug=cfg.get("debug", False),
            mpv_cmd=cfg.get("mpv_cmd"),
            data_dir=data_dir,
        )

    @classmethod
    def from_config_file(cls, config_path: str, data_dir: str = "."):
        """从配置文件创建播放器实例（自动检测文件格式）

        支持 .ini 和 .json 格式

        参数:
          config_path: 配置文件路径
          data_dir: 数据文件存储目录

        返回:
          MusicPlayer 实例
        """
        if not os.path.exists(config_path):
            raise FileNotFoundError(f"配置文件不存在: {config_path}")

        _, ext = os.path.splitext(config_path)
        if ext.lower() == ".ini":
            return cls.from_ini_file(config_path, data_dir)
        elif ext.lower() == ".json":
            return cls.from_json_file(config_path, data_dir)
        else:
            raise ValueError(f"不支持的配置文件格式: {ext}（支持 .ini 和 .json）")

    @staticmethod
    def _read_ini_file(ini_path: str) -> dict:
        """读取INI配置文件"""
        cfg = MusicPlayer.DEFAULT_CONFIG.copy()
        try:
            parser = configparser.ConfigParser()
            parser.read(ini_path, encoding="utf-8")
            if "app" in parser:
                for key, value in parser["app"].items():
                    cfg[key.upper()] = value
            try:
                logger.info(f"已从 {ini_path} 加载配置")
            except UnicodeEncodeError:
                logger.info(f"Loaded config from {ini_path}")
        except Exception as e:
            try:
                logger.warning(f"读取配置文件失败: {e}，使用默认配置")
            except UnicodeEncodeError:
                logger.warning(f"Failed to read config file: {e}, using default")
        return cfg

    @staticmethod
    def _read_json_file(json_path: str) -> dict:
        """读取JSON配置文件"""
        cfg = MusicPlayer.DEFAULT_CONFIG.copy()
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                # 支持两种格式：
                # 1. 直接配置项
                # 2. 嵌套在 'player' 或 'app' 字段下
                if isinstance(data, dict):
                    if "player" in data:
                        cfg.update(data["player"])
                    elif "app" in data:
                        cfg.update(data["app"])
                    else:
                        cfg.update(data)
            logger.info(f"已从 {json_path} 加载配置")
        except Exception as e:
            logger.warning(f"读取配置文件失败: {e}，使用默认配置")
        return cfg

    @staticmethod
    def save_config_to_ini(ini_path: str, config: dict):
        """将配置保存为INI文件

        参数:
          ini_path: 输出文件路径
          config: 配置字典
        """
        parser = configparser.ConfigParser()
        parser["app"] = {}
        for key, value in config.items():
            parser["app"][key] = str(value) if value is not None else ""

        try:
            with open(ini_path, "w", encoding="utf-8") as f:
                parser.write(f)
            logger.info(f"配置已保存到 {ini_path}")
        except Exception as e:
            logger.error(f"保存配置文件失败: {e}")

    @staticmethod
    def save_config_to_json(json_path: str, config: dict):
        """将配置保存为JSON文件

        参数:
          json_path: 输出文件路径
          config: 配置字典
        """
        try:
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
            logger.info(f"配置已保存到 {json_path}")
        except Exception as e:
            logger.error(f"保存配置文件失败: {e}")

    def save_config(self, config_path: str):
        """将当前配置保存到文件

        参数:
          config_path: 输出文件路径
        """
        config = self.to_dict()
        _, ext = os.path.splitext(config_path)
        if ext.lower() == ".ini":
            self.save_config_to_ini(config_path, config)
        elif ext.lower() == ".json":
            self.save_config_to_json(config_path, config)
        else:
            raise ValueError(f"不支持的配置文件格式: {ext}（支持 .ini 和 .json）")

    def _normalize_music_dir(self, path: str) -> str:
        """规范化音乐目录路径"""
        if len(path) == 2 and path[1] == ":" and path[0].isalpha():
            path += "\\"
        return os.path.abspath(path)

    def _parse_extensions(self, ext_str: str) -> set:
        """解析扩展名字符串"""
        if isinstance(ext_str, str):
            parts = [
                e.strip() for e in ext_str.replace(";", ",").split(",") if e.strip()
            ]
        else:
            parts = list(ext_str)
        return set([e if e.startswith(".") else "." + e for e in parts])

    def load_playback_history(self):
        """从文件加载播放历史"""
        self.playback_history.load()

    def save_playback_history(self):
        """保存播放历史到文件"""
        self.playback_history.save()

    def load_current_playlist(self):
        """从文件加载当前播放列表"""
        import traceback
        try:
            if os.path.exists(self.current_playlist_file):
                with open(self.current_playlist_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        self.current_playlist.from_dict(data)
                        logger.info(f"已加载播放列表: {self.current_playlist.size()} 首歌曲")
                    else:
                        from models import CurrentPlaylist
                        self.current_playlist = CurrentPlaylist()
            else:
                from models import CurrentPlaylist
                self.current_playlist = CurrentPlaylist()
        except Exception as e:
            logger.error(f"加载播放列表失败: {e}")
            traceback.print_exc()
            from models import CurrentPlaylist
            self.current_playlist = CurrentPlaylist()

    def save_current_playlist(self):
        """保存当前播放列表到文件"""
        try:
            data = self.current_playlist.to_dict()
            with open(self.current_playlist_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"保存播放列表失败: {e}")

    # ========== MPV IPC 初始化方法 ==========

    def _init_mpv_ipc(self):
        """初始化 MPV IPC 连接（在播放器初始化时只调用一次）"""
        self._extract_pipe_name_from_cmd()
        self.ensure_mpv()

    def _extract_pipe_name_from_cmd(self):
        """从 MPV 命令行中提取管道名称"""
        if not self.mpv_cmd:
            self.pipe_name = r"\\.\pipe\mpv-pipe"  # 默认管道名称
            return

        match = re.search(
            r'--input-ipc-server\s*=?\s*(["\']?)(.+?)\1(?:\s|$)', self.mpv_cmd
        )
        if match:
            self.pipe_name = match.group(2)
        else:
            self.pipe_name = r"\\.\pipe\mpv-pipe"  # 默认管道名称

    def mpv_pipe_exists(self) -> bool:
        """检查 MPV 管道是否存在（仅在 Windows 上检查）"""
        if not self.pipe_name:
            return False
        try:
            with open(self.pipe_name, "wb") as _:
                return True
        except (OSError, IOError):
            return False

    def _wait_pipe(self, timeout=6.0) -> bool:
        """等待 MPV 管道就绪"""
        end = time.time() + timeout
        while time.time() < end:
            try:
                with open(self.pipe_name, "wb") as _:
                    return True
            except Exception:
                time.sleep(0.15)
        return False

    def ensure_mpv(self) -> bool:
        """确保 MPV 进程运行并且 IPC 管道就绪

        返回:
          True 如果 mpv 管道可用，False 否则
        """
        # 每次调用重新解析，允许运行期间修改 MPV_CMD 并热加载
        self._extract_pipe_name_from_cmd()

        if not self.mpv_cmd:
            logger.warning("未配置 MPV_CMD")
            return False

        if self.mpv_pipe_exists():
            return True

        # 清理任何现存的 mpv 进程，防止重复启动
        try:
            if os.name == "nt":
                subprocess.run(
                    ["taskkill", "/IM", "mpv.exe", "/F"], capture_output=True, timeout=2
                )
                time.sleep(0.3)  # 让进程完全退出
        except Exception as e:
            logger.debug(f"清理 mpv 进程时的异常（可忽略）: {e}")

        logger.info(f"尝试启动 mpv: {self.mpv_cmd}")
        try:
            # 主程序目录下的 bin 子目录中查找 yt-dlp
            app_dir = MusicPlayer._get_app_dir()
            yt_dlp_path = None
            
            bin_yt_dlp = os.path.join(app_dir, "bin", "yt-dlp.exe")
            if os.path.exists(bin_yt_dlp):
                yt_dlp_path = bin_yt_dlp
                logger.info(f"在主程序目录 {app_dir}\\bin 找到 yt-dlp: {bin_yt_dlp}")
            
            # 构建完整的启动命令
            mpv_launch_cmd = self.mpv_cmd
            
            # 【新增】检查环境变量中是否有运行时选择的音频设备
            runtime_audio_device = os.environ.get("MPV_AUDIO_DEVICE", "")
            if runtime_audio_device:
                # 移除现有的 --audio-device 参数
                import re
                mpv_launch_cmd = re.sub(r'\s*--audio-device=[^\s]+', '', mpv_launch_cmd)
                mpv_launch_cmd = mpv_launch_cmd.strip() + f" --audio-device={runtime_audio_device}"
                logger.info(f"使用运行时选择的音频设备: {runtime_audio_device}")
            
            # 确保启用 mpv 的 ytdl 集成
            if "--ytdl=" not in mpv_launch_cmd:
                mpv_launch_cmd += " --ytdl=yes"
            if yt_dlp_path:
                # 将路径中的反斜杠转换为正斜杠，避免转义问题
                yt_dlp_path_escaped = yt_dlp_path.replace("\\", "/")
                mpv_launch_cmd += f' --script-opts=ytdl_hook-ytdl_path="{yt_dlp_path_escaped}"'
                logger.info(f"配置 MPV 使用 yt-dlp: {yt_dlp_path}")
            else:
                logger.info(f"未找到 yt-dlp，将使用系统 PATH")
            
            # ✅ 显示完整的启动命令（多种格式）
            logger.info("=" * 120)
            logger.info("🚀 MPV 完整启动命令")
            logger.info("=" * 120)
            
            # 格式 1：完整单行命令
            logger.info("")
            logger.info("[完整命令行]")
            logger.info(mpv_launch_cmd)
            logger.info("")
            
            # 格式 2：按参数分解显示（更详细）
            logger.info("[执行参数分解]")
            import shlex
            try:
                # 使用 shlex 进行参数分解（Windows 模式）
                # 在 Windows 上，shlex 默认 posix=False，但需要明确设置
                parsed_args = shlex.split(mpv_launch_cmd, posix=False)
                logger.info(f"  程序路径: {parsed_args[0]}")
                logger.info(f"  总参数数: {len(parsed_args) - 1}")
                logger.info("")
                
                # 逐个显示每个参数
                for idx, arg in enumerate(parsed_args[1:], 1):
                    # 格式化参数显示
                    if "=" in arg and arg.startswith("--"):
                        # 参数形式: --key=value
                        parts = arg.split("=", 1)
                        logger.info(f"  [{idx:2d}] {parts[0]} = {parts[1]}")
                    elif arg.startswith("--"):
                        # 参数形式: --key
                        logger.info(f"  [{idx:2d}] {arg}")
                    elif arg.startswith("-"):
                        # 短参数
                        logger.info(f"  [{idx:2d}] {arg}")
                    else:
                        # 值参数（通常跟在某个参数后）
                        logger.info(f"  [{idx:2d}] {arg}")
            except Exception as e:
                logger.warning(f"参数分解异常: {e}，显示原始命令")
                logger.info(mpv_launch_cmd)
            
            logger.info("")
            logger.info("=" * 120)
            
            # 在 Windows 上使用 CREATE_NEW_PROCESS_GROUP 标志来避免进程被挂起
            import ctypes
            import shlex
            CREATE_NEW_PROCESS_GROUP = 0x00000200
            CREATE_NO_WINDOW = 0x08000000
            
            try:
                # 方法 1: 使用 shlex 解析命令字符串为列表，然后用 Popen
                # 重要：在 Windows 上使用 posix=False 避免反斜杠被当作转义字符
                cmd_list = shlex.split(mpv_launch_cmd, posix=False)
                mpv_exe_path = cmd_list[0]
                
                # 验证 MPV 可执行文件是否存在
                if not os.path.exists(mpv_exe_path):
                    # 尝试在 PATH 中查找
                    import shutil
                    mpv_in_path = shutil.which(mpv_exe_path)
                    if mpv_in_path:
                        logger.info(f"✅ 在 PATH 中找到 MPV: {mpv_in_path}")
                        cmd_list[0] = mpv_in_path
                    else:
                        logger.warning(f"⚠️  MPV 路径不存在: {mpv_exe_path}")
                        logger.info(f"尝试使用 shell=True 模式启动...")
                        raise FileNotFoundError(f"MPV not found: {mpv_exe_path}")
                
                logger.info(f"✅ 启动mpv进程 (shell=False)")
                logger.debug(f"  命令列表: {cmd_list}")
                process = subprocess.Popen(
                    cmd_list,
                    shell=False,
                    creationflags=CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
                self.mpv_process = process
                logger.info(f"✅ mpv进程已启动 (PID: {process.pid})")
            except Exception as e2:
                logger.warning(f"方法1失败: {e2}，尝试方法2 (shell=True)")
                logger.debug(f"  原始命令: {mpv_launch_cmd}")
                try:
                    process = subprocess.Popen(mpv_launch_cmd, shell=True)
                    self.mpv_process = process
                    logger.info(f"✅ mpv进程已启动 (shell=True, PID: {process.pid})")
                except Exception as e3:
                    logger.error(f"❌ 方法2也失败: {e3}")
                    logger.error(f"请检查 MPV 路径配置: {self.mpv_cmd}")
                    raise
        except Exception as e:
            logger.error("启动 mpv 进程失败:", e)
            return False

        ready = self._wait_pipe()
        if not ready:
            logger.error("等待 mpv 管道超时: ", self.pipe_name)
        return ready

    def mpv_command(self, cmd_list) -> bool:
        """向 MPV 发送命令

        写命令，失败时自动尝试启动一次再重试
        """

        def _write():
            # Debug: 显示发送的命令
            logger.debug(f"mpv_command -> sending: {cmd_list} to pipe {self.pipe_name}")
            
            # ✅ 对特定命令显示更详细的日志
            if cmd_list and len(cmd_list) > 0:
                cmd_name = cmd_list[0]
                if cmd_name == "loadfile":
                    file_url = cmd_list[1] if len(cmd_list) > 1 else 'N/A'
                    logger.info(f"📂 [MPV 命令] loadfile: {file_url[:100]}{'...' if len(file_url) > 100 else ''}")
                    
                    # 显示当前 MPV 完整配置信息（包含运行时参数）
                    runtime_audio_device = os.environ.get("MPV_AUDIO_DEVICE", "")
                    mpv_display_cmd = self.mpv_cmd
                    
                    if runtime_audio_device:
                        # 如果有运行时音频设备，显示完整命令
                        import re
                        mpv_display_cmd = re.sub(r'\s*--audio-device=[^\s]+', '', mpv_display_cmd)
                        mpv_display_cmd = mpv_display_cmd.strip() + f" --audio-device={runtime_audio_device}"
                    
                    logger.info(f"   🎵 MPV 完整命令: {mpv_display_cmd}")
                    
                    # 对于网络歌曲（YouTube等），显示额外的参数
                    is_network_url = file_url.startswith(('http://', 'https://'))
                    if is_network_url:
                        logger.info(f"   🌐 网络播放模式")
                        logger.info(f"   📋 完整命令参数: {mpv_display_cmd} \"{file_url}\"")
                        # 显示 ytdl 相关属性
                        try:
                            ytdl_format = self.mpv_get("ytdl-format")
                            if ytdl_format:
                                logger.info(f"   🎬 ytdl-format: {ytdl_format}")
                        except:
                            pass
                    
                    # 显示音频输出设备
                    if runtime_audio_device:
                        logger.info(f"   🔊 音频设备: {runtime_audio_device}")
                    else:
                        logger.info(f"   🔊 音频设备: 系统默认")
                        
                elif cmd_name == "set_property":
                    if len(cmd_list) >= 3:
                        logger.info(f"⚙️  [MPV 命令] set_property: {cmd_list[1]} = {cmd_list[2]}")
                    else:
                        logger.info(f"⚙️  [MPV 命令] set_property: {cmd_list}")
                elif cmd_name == "cycle":
                    logger.info(f"🔄 [MPV 命令] cycle: {cmd_list[1] if len(cmd_list) > 1 else 'N/A'}")
                elif cmd_name == "stop":
                    logger.info(f"⏹️  [MPV 命令] stop")
                else:
                    logger.debug(f"[MPV 命令] {cmd_name}: {cmd_list[1:] if len(cmd_list) > 1 else 'N/A'}")
            
            with open(self.pipe_name, "wb") as w:
                json_cmd = json.dumps({"command": cmd_list})
                w.write((json_cmd + "\n").encode("utf-8"))
                logger.debug(f"✅ 命令已发送到管道: {self.pipe_name}")
                logger.debug(f"  JSON内容: {json_cmd}")

        try:
            _write()
            return True
        except FileNotFoundError as e:
            logger.error(f"❌ 管道不存在: {self.pipe_name}")
            logger.error(f"   详情: {e}")
            logger.warning(f"尝试通过 ensure_mpv() 重新启动 mpv...")
            if self.ensure_mpv():
                try:
                    _write()
                    logger.info(f"✅ 重试后命令发送成功")
                    return True
                except Exception as e2:
                    logger.error(f"❌ 重试写入仍然失败: {e2}")
                    return False
            return False
        except Exception as e:
            import traceback

            logger.error(f"❌ 写入命令失败: {e}")
            logger.debug(f"  异常类型: {type(e).__name__}")
            logger.debug(f"  管道路径: {repr(self.pipe_name)}")
            logger.debug(f"  完整堆栈:")
            traceback.print_exc()
            
            # 检查 mpv 进程状态
            try:
                if os.name == "nt":
                    tl = subprocess.run(
                        ["tasklist", "/FI", "IMAGENAME eq mpv.exe"],
                        capture_output=True,
                        text=True,
                    )
                    if "mpv.exe" in tl.stdout:
                        logger.info(f"✓ mpv.exe 进程存在")
                    else:
                        logger.error(f"✗ mpv.exe 进程不存在，需要重新启动")
            except Exception:
                pass

            logger.warning(f"尝试通过 ensure_mpv() 重新启动 mpv...")
            if self.ensure_mpv():
                try:
                    _write()
                    logger.info(f"✅ 重试后命令发送成功")
                    return True
                except Exception as e2:
                    logger.error(f"❌ 重试写入仍然失败: {e2}")
                    return False
            return False

    def mpv_request(self, payload: dict):
        """向 MPV 发送请求并等待响应"""
        with open(self.pipe_name, "r+b", 0) as f:
            f.write((json.dumps(payload) + "\n").encode("utf-8"))
            f.flush()
            while True:
                line = f.readline()
                if not line:
                    break
                try:
                    obj = json.loads(line.decode("utf-8", "ignore"))
                except Exception:
                    continue
                if obj.get("request_id") == payload.get("request_id"):
                    return obj
        return None

    def mpv_get(self, prop: str):
        """获取 MPV 属性值"""
        self._req_id += 1
        req = {"command": ["get_property", prop], "request_id": self._req_id}
        resp = self.mpv_request(req)
        if not resp:
            return None
        return resp.get("data")

    def mpv_set(self, prop: str, value) -> bool:
        """设置 MPV 属性值"""
        try:
            self.mpv_command(["set_property", prop, value])
            return True
        except Exception:
            return False

    # ========== 播放控制方法（音量、seek、暂停等） ==========

    def get_volume(self) -> float:
        """获取当前音量（0-130）"""
        vol = self.mpv_get("volume")
        if vol is not None:
            return vol
        return 0.0

    def set_volume(self, volume: float) -> bool:
        """设置音量

        参数:
          volume: 音量值（0-130）

        返回:
          bool: 设置是否成功
        """
        # 限制范围
        if volume < 0:
            volume = 0
        elif volume > 130:
            volume = 130

        return self.mpv_set("volume", volume)

    def seek(self, percent: float) -> bool:
        """跳转到指定播放位置

        参数:
          percent: 播放进度百分比（0-100）

        返回:
          bool: 跳转是否成功
        """
        # 限制范围
        if percent < 0:
            percent = 0
        elif percent > 100:
            percent = 100

        return self.mpv_command(["seek", str(percent), "absolute-percent"])

    def toggle_pause(self) -> bool:
        """切换暂停/播放状态

        返回:
          bool: 操作是否成功
        """
        return self.mpv_command(["cycle", "pause"])

    def toggle_loop_mode(self) -> int:
        """循环播放模式切换: 0=不循环 -> 1=单曲循环 -> 2=全部循环 -> 0

        返回:
          int: 当前循环模式 (0, 1, 或 2)
        """
        self.loop_mode = (self.loop_mode + 1) % 3
        return self.loop_mode

    def get_pause_state(self) -> bool:
        """获取暂停状态

        返回:
          bool: True 表示已暂停，False 表示播放中
        """
        paused = self.mpv_get("pause")
        return paused if paused is not None else False

    def stop_playback(self) -> bool:
        """停止播放

        返回:
          bool: 停止是否成功
        """
        return self.mpv_command(["stop"])

    def add_to_playback_history(
        self, url_or_path: str, name: str, is_local: bool = False, thumbnail_url: str = None
    ):
        """添加播放历史"""
        self.playback_history.add_to_history(url_or_path, name, is_local, thumbnail_url)

    def safe_path(self, rel: str) -> str:
        """验证并返回安全的文件路径"""
        base = os.path.abspath(self.music_dir)
        target = os.path.abspath(os.path.join(base, rel))
        if not target.startswith(base):
            raise ValueError("非法路径")
        if not os.path.exists(target):
            raise ValueError("不存在的文件")
        return target

    def gather_tracks(self, root: str) -> list:
        """收集目录下的所有音乐文件"""
        tracks = []
        try:
            for dp, _, files in os.walk(root):
                for f in files:
                    ext = os.path.splitext(f)[1].lower()
                    if ext in self.allowed_extensions:
                        tracks.append(os.path.abspath(os.path.join(dp, f)))
        except Exception as e:
            logger.warning(f"遍历目录失败: {e}")
        return tracks

    def build_tree(self) -> dict:
        """构建音乐目录树结构

        返回:
          包含目录和文件信息的嵌套字典
        """
        abs_root = os.path.abspath(self.music_dir)

        def walk(path):
            rel = os.path.relpath(path, abs_root).replace("\\", "/")
            node = {
                "name": os.path.basename(path) or "根目录",
                "rel": "" if rel == "." else rel,
                "dirs": [],
                "files": [],
            }
            try:
                for name in sorted(os.listdir(path), key=str.lower):
                    full = os.path.join(path, name)
                    if os.path.isdir(full):
                        node["dirs"].append(walk(full))
                    else:
                        ext = os.path.splitext(name)[1].lower()
                        if ext in self.allowed_extensions:
                            rp = os.path.relpath(full, abs_root).replace("\\", "/")
                            node["files"].append({"name": name, "rel": rp})
            except Exception:
                pass
            return node

        return walk(abs_root)

    def build_playlist(self) -> list:
        """构建播放列表（所有音乐文件的相对路径列表）

        返回:
          排序后的相对路径列表
        """
        abs_root = os.path.abspath(self.music_dir)
        tracks = []
        for dp, _, files in os.walk(abs_root):
            for f in files:
                ext = os.path.splitext(f)[1].lower()
                if ext in self.allowed_extensions:
                    rel = os.path.relpath(os.path.join(dp, f), abs_root).replace(
                        "\\", "/")
                    tracks.append(rel)
        tracks.sort(key=str.lower)
        return tracks

    def search_local(self, query: str, max_results: int = 20) -> list:
        """搜索本地音乐库
        
        参数:
          query: 搜索关键词
          max_results: 最大返回结果数（默认20）
        
        返回:
          匹配的歌曲列表 [{"url": "相对路径", "title": "文件名", "type": "local"}, ...]
        """
        if not query or not query.strip():
            return []
        
        query_lower = query.strip().lower()
        results = []
        abs_root = os.path.abspath(self.music_dir)
        
        try:
            # 遍历整个音乐目录
            for dp, _, files in os.walk(abs_root):
                for filename in files:
                    ext = os.path.splitext(filename)[1].lower()
                    if ext in self.allowed_extensions:
                        # 检查文件名是否包含搜索关键词
                        if query_lower in filename.lower():
                            rel_path = os.path.relpath(os.path.join(dp, filename), abs_root).replace("\\", "/")
                            # 移除扩展名作为标题
                            title = os.path.splitext(filename)[0]
                            results.append({
                                "url": rel_path,
                                "title": title,
                                "type": "local"
                            })
                            
                            # 达到最大结果数时停止
                            if len(results) >= max_results:
                                return results
        except Exception as e:
            logger.error(f"本地搜索失败: {e}")
        
        return results

    def build_local_queue(
        self, folder_path: str = None, clear_existing: bool = True
    ) -> int:
        """从本地文件夹构建播放队列

        参数:
          folder_path: 文件夹路径（相对于music_dir），为None时使用整个music_dir
          clear_existing: 是否清空现有队列

        返回:
          添加到队列的歌曲数量
        """
        if clear_existing:
            self.current_playlist.clear()

        # 确定扫描路径
        if folder_path:
            abs_path = os.path.join(os.path.abspath(self.music_dir), folder_path)
        else:
            abs_path = os.path.abspath(self.music_dir)

        if not os.path.exists(abs_path) or not os.path.isdir(abs_path):
            logger.warning(f"路径不存在或不是文件夹: {abs_path}")
            return 0

        # 收集所有音乐文件
        abs_root = os.path.abspath(self.music_dir)
        tracks = []
        for dp, _, files in os.walk(abs_path):
            for f in files:
                ext = os.path.splitext(f)[1].lower()
                if ext in self.allowed_extensions:
                    rel = os.path.relpath(os.path.join(dp, f), abs_root).replace(
                        "\\", "/"
                    )
                    tracks.append(rel)

        # 排序
        tracks.sort(key=str.lower)

        # 添加到播放队列
        for rel_path in tracks:
            song = LocalSong(rel_path, os.path.basename(rel_path))
            self.current_playlist.add(song)

        # 如果队列不为空，设置当前索引为第一首
        if not self.current_playlist.is_empty():
            self.current_playlist.set_current_index(0)

        logger.info(f"已从 {folder_path or 'music_dir'} 添加 {len(tracks)} 首歌曲到队列")
        return len(tracks)

    # ========== 播放控制方法 ==========

    def play_index(
        self,
        playlist: list,
        idx: int,
        mpv_command_func,
        mpv_pipe_exists_func,
        ensure_mpv_func,
        save_history: bool = True,
    ):
        """播放播放列表中指定索引的本地文件

        参数:
          playlist: 播放列表（相对路径列表）
          idx: 要播放的索引
          mpv_command_func: mpv 命令执行函数
          mpv_pipe_exists_func: mpv 管道检查函数
          ensure_mpv_func: mpv 确保启动函数
          save_history: 是否保存到播放历史

        返回:
          成功返回 True，失败返回 False
        """
        if idx < 0 or idx >= len(playlist):
            return False

        rel = playlist[idx]
        abs_file = self.safe_path(rel)

        # Debug: print play info
        logger.debug(f"play_index -> idx={idx}, rel={rel}, abs_file={abs_file}")

        try:
            # 确保 mpv 管道存在，否则尝试启动 mpv
            if not mpv_pipe_exists_func():
                logger.warning(f"mpv 管道不存在，尝试启动 mpv...")
                if not ensure_mpv_func():
                    raise RuntimeError("无法启动或连接到 mpv")
            mpv_command_func(["loadfile", abs_file, "replace"])
        except Exception as e:
            logger.error(f"mpv_command failed when playing {abs_file}: {e}")
            raise

        self.current_index = idx
        self.current_meta = {
            "abs_path": abs_file,
            "rel": rel,
            "index": idx,
            "ts": int(time.time()),
            "name": os.path.basename(rel),
        }
        self._last_play_time = time.time()  # 记录播放开始时间

        # 添加到播放历史（存储相对路径，以便 /play 接口使用）
        if save_history:
            self.add_to_playback_history(rel, os.path.basename(rel), is_local=True)

        logger.debug(f"CURRENT_INDEX set to {self.current_index}")
        return True

    def play_url(
        self,
        url: str,
        mpv_command_func,
        mpv_pipe_exists_func,
        ensure_mpv_func,
        mpv_get_func,
        save_to_history: bool = True,
        update_queue: bool = True,
    ):
        """播放网络 URL（如 YouTube）。使用 --ytdl-format=bestaudio 标志让 mpv 正确处理 YouTube。

        参数:
          url: 要播放的 URL
          mpv_command_func: mpv 命令执行函数
          mpv_pipe_exists_func: mpv 管道检查函数
          ensure_mpv_func: mpv 确保启动函数
          mpv_get_func: mpv 属性获取函数
          save_to_history: 是否保存该 URL 到历史记录（仅保存用户直接输入的URL）
          update_queue: 是否更新播放队列（如果False则只播放该URL，保持现有队列）

        返回:
          成功返回 True，失败返回 False
        """
        import subprocess
        import sys

        logger.debug(f"play_url -> url={url}, save_to_history={save_to_history}, update_queue={update_queue}") 
        try:
            # 检查 mpv 进程是否运行
            if not mpv_pipe_exists_func():
                logger.warning(f"mpv pipe 不存在，尝试启动 mpv...")
                if not ensure_mpv_func():
                    raise RuntimeError("无法启动或连接到 mpv")

            # 注意：通过 IPC 发送选项标志（如 --ytdl-format）需要特殊处理。
            # 更好的方法是先设置 ytdl-format 属性，再加载文件。
            logger.debug(f"设置 mpv 属性: ytdl-format=bestaudio")
            mpv_command_func(["set_property", "ytdl-format", "bestaudio"])
            
            # 对于 YouTube URL，优先使用 yt-dlp 获取直链来确保播放成功
            actual_url = url
            if "youtube.com" in url or "youtu.be" in url:
                logger.info(f"🎬 检测到 YouTube URL，尝试通过 yt-dlp 获取直链...")
                # 主程序目录下的 bin 子目录
                app_dir = MusicPlayer._get_app_dir()
                bin_yt_dlp = os.path.join(app_dir, "bin", "yt-dlp.exe")
                
                if os.path.exists(bin_yt_dlp):
                    yt_dlp_exe = bin_yt_dlp
                    logger.info(f"   📦 使用 yt-dlp: {bin_yt_dlp}")
                else:
                    logger.info(f"   📦 yt-dlp.exe 不在 {bin_dir} 目录，使用系统 PATH")
                    yt_dlp_exe = "yt-dlp"
                
                try:
                    logger.info(f"   ⏳ 运行命令: {yt_dlp_exe} -g {url[:50]}...")
                    result = subprocess.run(
                        [yt_dlp_exe, "-g", url],
                        capture_output=True,
                        text=True,
                        timeout=30
                    )
                    if result.returncode == 0:
                        direct_urls = result.stdout.strip().split("\n")
                        if direct_urls and direct_urls[0]:
                            actual_url = direct_urls[-1].strip()  # 通常最后一个是音频/最优质
                            logger.info(f"   ✅ 获取到直链（前100字符）: {actual_url[:100]}...")
                    else:
                        logger.warning(f"   ⚠️  yt-dlp -g 失败 (code={result.returncode}): {result.stderr[:200]}")
                except Exception as e:
                    logger.warning(f"   ⚠️  yt-dlp 获取直链异常: {e}，使用原始 URL")
            
            logger.info(f"📤 调用 mpv loadfile 播放网络歌曲...")
            mpv_command_func(["loadfile", actual_url, "replace"])
            logger.debug(f"已向 mpv 发送播放命令")

            # 保存当前本地播放状态，以便网络流结束后恢复
            self._prev_index = self.current_index
            self._prev_meta = dict(self.current_meta) if self.current_meta else None

            # 初始化 CURRENT_META：保留 raw_url，并使用占位名（避免将原始 URL 直接显示给用户）
            # 同时准备 media_title 字段供客户端优先显示
            self.current_meta = {
                "abs_path": url,
                "rel": url,
                "index": -1,
                "ts": int(time.time()),
                "name": "加载中…",
                "raw_url": url,
                "media_title": None,
            }

            # 检测是否为播放列表 URL
            is_playlist = False
            playlist_entries = []
            if (
                "youtube.com/playlist" in url
                or "youtu.be" in url
                or "youtube.com/watch" in url
            ):
                try:
                    # 使用 yt-dlp 获取播放列表信息
                    logger.debug(f"尝试使用 yt-dlp 提取播放列表信息...")
                    # 查找 yt-dlp 可执行文件 - 使用统一的 bin_dir
                    app_dir = MusicPlayer._get_app_dir()
                    bin_dir = _read_bin_dir_from_config(app_dir)
                    bin_yt_dlp = os.path.join(app_dir, bin_dir, "yt-dlp.exe")
                    
                    if os.path.exists(bin_yt_dlp):
                        yt_dlp_exe = bin_yt_dlp
                    else:
                        yt_dlp_exe = "yt-dlp"
                    cmd = [yt_dlp_exe, "--flat-playlist", "-j", url]
                    result = subprocess.run(
                        cmd, capture_output=True, text=True, timeout=30
                    )
                    if result.returncode == 0:
                        lines = result.stdout.strip().split("\n")
                        for line in lines:
                            if line.strip():
                                try:
                                    entry = json.loads(line)
                                    if isinstance(entry, dict):
                                        entry_url = entry.get("url") or entry.get("id")
                                        entry_title = entry.get("title", "未知")
                                        # 构建完整 YouTube URL
                                        if entry_url and not entry_url.startswith(
                                            "http"
                                        ):
                                            if len(entry_url) == 11:  # 可能是视频 ID
                                                entry_url = f"https://www.youtube.com/watch?v={entry_url}"
                                        playlist_entries.append(
                                            {
                                                "url": entry_url,
                                                "title": entry_title,
                                                "ts": int(time.time()),
                                            }
                                        )
                                except json.JSONDecodeError:
                                    pass
                        if playlist_entries:
                            is_playlist = True
                            logger.debug(f"检测到播放列表，共 {len(playlist_entries)} 项") 
                except Exception as e:
                    logger.warning(f"提取播放列表失败: {e}")
                    is_playlist = False
                    playlist_entries = []

            # 添加到播放历史
            if is_playlist:
                # 如果是播放列表，仅在save_to_history为True时添加原始URL（播放列表URL）
                if save_to_history:
                    playlist_name = f"播放列表 ({len(playlist_entries)} 首)"
                    self.add_to_playback_history(url, playlist_name, is_local=False)
                else:
                    logger.debug(f"跳过添加播放列表到历史记录 (save_to_history=False)")
                # 设置当前播放队列（仅当update_queue为True时）
                if update_queue:
                    # 清空现有队列并添加播放列表项
                    self.current_playlist.clear()
                    for entry in playlist_entries:
                        song = StreamSong(entry["url"], entry["title"])
                        self.current_playlist.add(song)
                    self.current_playlist.set_current_index(0)
                    logger.debug(f"已将播放列表添加到队列，共 {len(playlist_entries)} 项") 
            else:
                # 单个视频的添加逻辑
                if save_to_history:
                    self.add_to_playback_history(url, "加载中…", is_local=False)
                else:
                    logger.debug(f"跳过添加单个视频到历史记录 (save_to_history=False)")
                # 单个视频的队列（仅当update_queue为True时）
                if update_queue:
                    # 允许重复添加相同的URL，不进行去重检查
                    self.current_playlist.clear()
                    song = StreamSong(url, "加载中…")
                    self.current_playlist.add(song)
                    self.current_playlist.set_current_index(0)
                    logger.debug(f"创建新播放队列（单个视频）")

            # 尝试轮询获取 mpv 的 media-title，最多尝试 20 次（大约 10 秒）
            def _is_invalid_title(tit, urlraw):
                try:
                    if not tit or not isinstance(tit, str):
                        return True
                    s = tit.strip()
                    if not s:
                        return True
                    # 如果返回看起来像 URL 或直接包含原始 URL，则视为无效
                    if (
                        s.startswith("http")
                        or s.startswith("https")
                        or urlraw
                        and s == urlraw
                    ):
                        return True
                    # 常见 YouTube ID（11字符且仅字母数字-_）不作为有效标题
                    if len(s) == 11 and all(c.isalnum() or c in ("-", "_") for c in s):
                        return True
                    # 含有 youtube 域名或 youtu 标记也可能是无效（如 mpv 暂时返回片段）
                    if "youtu" in s.lower():
                        return True
                    return False
                except Exception:
                    return True

            for attempt in range(20):
                time.sleep(0.5)
                try:
                    media_title = mpv_get_func("media-title")
                    if (
                        media_title
                        and isinstance(media_title, str)
                        and not _is_invalid_title(media_title, url)
                    ):
                        # 将获得的媒体标题写入 media_title 字段，并同步更新用户可见的 name
                        self.current_meta["media_title"] = media_title
                        self.current_meta["name"] = media_title
                        # 更新历史记录中最新项的标题（仅当save_to_history为True时）
                        if save_to_history and not self.playback_history.is_empty():
                            history_items = self.playback_history.get_all()
                            if history_items and history_items[0]["url"] == url:
                                self.playback_history.update_item(0, name=media_title)
                        logger.debug(f"mpv media-title 探测到 (尝试 {attempt+1}): {media_title}") 
                        break
                    else:
                        if attempt < 4:
                            logger.debug(f"media-title 未就绪或不符合 (尝试 {attempt+1}), 值: {repr(media_title)}") 
                except Exception as _e:
                    if attempt == 19:
                        logger.warning(f"无法读取 mpv media-title (最终失败): {_e}")

            # 记录播放开始时间
            self._last_play_time = time.time()
            logger.debug(f"已设置为播放 URL: {url}，启动时间戳: {self._last_play_time}") 
            return True
        except Exception as e:
            logger.error(f"play_url failed for {url}: {e}")
            import traceback

            traceback.print_exc()
            raise

    def next_track(
        self,
        playlist: list,
        mpv_command_func,
        mpv_pipe_exists_func,
        ensure_mpv_func,
        save_history: bool = True,
    ):
        """播放播放列表中的下一首歌曲

        参数:
          playlist: 播放列表（相对路径列表）
          mpv_command_func: mpv 命令执行函数
          mpv_pipe_exists_func: mpv 管道检查函数
          ensure_mpv_func: mpv 确保启动函数
          save_history: 是否保存到播放历史

        返回:
          成功返回 True，失败返回 False
        """
        if self.current_index < 0:
            return False

        nxt = self.current_index + 1
        if nxt >= len(playlist):
            return False

        return self.play_index(
            playlist=playlist,
            idx=nxt,
            mpv_command_func=mpv_command_func,
            mpv_pipe_exists_func=mpv_pipe_exists_func,
            ensure_mpv_func=ensure_mpv_func,
            save_history=save_history,
        )

    def previous_track(
        self,
        playlist: list,
        mpv_command_func,
        mpv_pipe_exists_func,
        ensure_mpv_func,
        save_history: bool = True,
    ):
        """播放播放列表中的上一首歌曲

        参数:
          playlist: 播放列表（相对路径列表）
          mpv_command_func: mpv 命令执行函数
          mpv_pipe_exists_func: mpv 管道检查函数
          ensure_mpv_func: mpv 确保启动函数
          save_history: 是否保存到播放历史

        返回:
          成功返回 True，失败返回 False
        """
        if self.current_index < 0:
            return False

        prv = self.current_index - 1
        if prv < 0:
            return False

        return self.play_index(
            playlist=playlist,
            idx=prv,
            mpv_command_func=mpv_command_func,
            mpv_pipe_exists_func=mpv_pipe_exists_func,
            ensure_mpv_func=ensure_mpv_func,
            save_history=save_history,
        )

    def play(
        self,
        song,
        mpv_command_func,
        mpv_pipe_exists_func,
        ensure_mpv_func,
        add_to_history_func=None,
        save_to_history: bool = True,
        mpv_cmd: str = None,
    ):
        """统一的播放接口，根据歌曲对象类型调用相应的播放方法

        参数:
          song: Song 对象（LocalSong 或 StreamSong）
          mpv_command_func: mpv 命令执行函数
          mpv_pipe_exists_func: 检查 mpv 管道是否存在的函数
          ensure_mpv_func: 确保 mpv 运行的函数
          add_to_history_func: 添加到历史记录的函数（可选）
          save_to_history: 是否保存到播放历史
          mpv_cmd: 实际使用的mpv启动命令（来自配置文件）

        返回:
          成功返回 True，失败返回 False
        """
        if not song:
            logger.error(f"play() called with None song")
            return False

        logger.debug(f"play() -> 播放歌曲: {song}")

        try:
            # 根据歌曲类型调用相应的播放方法
            # 注意：mpv_cmd 参数在 song.play() 中不需要，因为 mpv 已在 ensure_mpv 中启动
            success = song.play(
                mpv_command_func=mpv_command_func,
                mpv_pipe_exists_func=mpv_pipe_exists_func,
                ensure_mpv_func=ensure_mpv_func,
                add_to_history_func=add_to_history_func,
                save_to_history=save_to_history,
                music_dir=self.music_dir,
            )

            if not success:
                return False

            # 更新当前播放的元数据
            self.current_meta = song.to_dict()
            self._last_play_time = time.time()
            logger.debug(f"已更新 current_meta: {self.current_meta}")

            # 对于串流媒体，尝试获取真实的媒体标题
            if song.is_stream():
                import threading

                def _fetch_media_title():
                    """后台线程：获取串流媒体的真实标题"""

                    def _is_invalid_title(title, raw_url):
                        if not title or not isinstance(title, str):
                            return True
                        s = title.strip()
                        if not s or s.startswith("http"):
                            return True
                        if raw_url and s == raw_url:
                            return True
                        if "youtu" in s.lower():
                            return True
                        if len(s) == 11 and all(
                            c.isalnum() or c in ("-", "_") for c in s
                        ):
                            return True
                        return False

                    url = song.url
                    for attempt in range(20):
                        time.sleep(0.5)
                        try:
                            media_title = self.mpv_get("media-title")
                            if (
                                media_title
                                and isinstance(media_title, str)
                                and not _is_invalid_title(media_title, url)
                            ):
                                # 更新当前元数据
                                self.current_meta["media_title"] = media_title
                                self.current_meta["name"] = media_title
                                # 更新历史记录中的标题
                                if (
                                    save_to_history
                                    and not self.playback_history.is_empty()
                                ):
                                    history_items = self.playback_history.get_all()
                                    if history_items and history_items[0]["url"] == url:
                                        self.playback_history.update_item(
                                            0, name=media_title
                                        )
                                logger.debug(f"获取到串流媒体标题 (尝试 {attempt+1}): {media_title}") 
                                break
                            else:
                                if attempt < 4:
                                    logger.debug(f"媒体标题未就绪 (尝试 {attempt+1}), 值: {repr(media_title)}") 
                        except Exception as e:
                            if attempt == 19:
                                logger.warning(f"无法获取媒体标题: {e}")

                # 启动后台线程获取标题
                threading.Thread(
                    target=_fetch_media_title, daemon=True, name="FetchMediaTitle"
                ).start()

            return True
        except Exception as e:
            logger.error(f"play() failed: {e}")
            import traceback

            traceback.print_exc()
            return False

    def handle_track_end(
        self,
        mpv_command_func=None,
        mpv_pipe_exists_func=None,
        ensure_mpv_func=None,
        add_to_history_func=None,
    ) -> bool:
        """根据循环模式处理曲目结束后的自动播放逻辑

        返回 True 表示已启动下一首或重新播放当前首，False 表示无需自动播放。
        """
        mpv_command_func = mpv_command_func or self.mpv_command
        mpv_pipe_exists_func = mpv_pipe_exists_func or self.mpv_pipe_exists
        ensure_mpv_func = ensure_mpv_func or self.ensure_mpv
        add_to_history_func = add_to_history_func or self.add_to_playback_history

        if self.current_playlist.is_empty():
            logger.info("handle_track_end: 播放队列为空，停止自动播放")
            return False

        current_idx = self.current_playlist.get_current_index()
        playlist_size = self.current_playlist.size()

        def _play_at(index: int) -> bool:
            if not (0 <= index < queue_size):
                logger.warning(f"handle_track_end: 无效的索引 {index}，队列大小 {queue_size}")
                return False
            return self.current_playlist.play_at_index(
                index=index,
                save_to_history=True,
                mpv_command_func=mpv_command_func,
                mpv_pipe_exists_func=mpv_pipe_exists_func,
                ensure_mpv_func=ensure_mpv_func,
                add_to_history_func=add_to_history_func,
                music_dir=self.music_dir,
            )

        action_desc = "none"
        success = False

        if self.loop_mode == 1:
            # 单曲循环：重新播放当前索引（若无效则回到0）
            target_idx = current_idx if 0 <= current_idx < queue_size else 0
            action_desc = f"单曲循环 -> 重新播放索引 {target_idx}"
            success = _play_at(target_idx)
        elif self.loop_mode == 2:
            # 全部循环：先尝试下一首，末尾则回到第一首
            if self.current_playlist.has_next():
                action_desc = "全部循环 -> 下一首"
                success = self.current_playlist.play_next(
                    save_to_history=True,
                    mpv_command_func=mpv_command_func,
                    mpv_pipe_exists_func=mpv_pipe_exists_func,
                    ensure_mpv_func=ensure_mpv_func,
                    add_to_history_func=add_to_history_func,
                    music_dir=self.music_dir,
                )
            elif queue_size > 0:
                action_desc = "全部循环 -> 回到第一首"
                success = _play_at(0)
        else:
            # 顺序播放（loop_mode=0）：仅在有下一首时继续
            if self.current_playlist.has_next():
                action_desc = "顺序播放 -> 下一首"
                success = self.current_playlist.play_next(
                    save_to_history=True,
                    mpv_command_func=mpv_command_func,
                    mpv_pipe_exists_func=mpv_pipe_exists_func,
                    ensure_mpv_func=ensure_mpv_func,
                    add_to_history_func=add_to_history_func,
                    music_dir=self.music_dir,
                )
            else:
                action_desc = "顺序播放 -> 末尾已停止"
                success = False

        logger.info(f"handle_track_end: {action_desc}, success={success}, current_idx={current_idx}, queue_size={queue_size}")

        if success:
            # 成功启动后更新时间戳并持久化队列
            self._last_play_time = time.time()
            try:
                self.save_current_playlist()
            except Exception as e:
                logger.warning(f"保存播放列表失败: {e}")
        return success

    def to_dict(self) -> dict:
        """转换为字典（用于序列化保存配置）"""
        return {
            "MUSIC_DIR": self.music_dir,
            "ALLOWED_EXTENSIONS": ",".join(sorted(self.allowed_extensions)),
            "FLASK_HOST": self.flask_host,
            "FLASK_PORT": str(self.flask_port),
            "DEBUG": "true" if self.debug else "false",
            "MPV_CMD": self.mpv_cmd or "",
        }

    def __repr__(self):
        return (
            f"MusicPlayer(music_dir='{self.music_dir}', "
            f"queue_size={self.current_playlist.size()}, "
            f"history_size={len(self.playback_history)})"
        )
