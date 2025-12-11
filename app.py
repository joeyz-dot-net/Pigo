# -*- coding: utf-8 -*-
import os, sys, json, threading, time, subprocess, configparser, platform

# 确保 stdout 使用 UTF-8 编码（Windows 兼容性）
if sys.stdout.encoding != "utf-8":
    import io

    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

from flask import Flask, render_template, jsonify, request, abort, send_file
from werkzeug.utils import secure_filename
from PIL import Image, ImageDraw, ImageFont
from io import BytesIO

#############################################
# 导入数据模型
#############################################
from models import Song, LocalSong, StreamSong, PlayQueue, MusicPlayer, Playlists

#############################################
# 资源路径辅助函数
#############################################


def _get_resource_path(relative_path):
    """获取资源文件的绝对路径，支持打包后的环境"""
    if getattr(sys, "frozen", False):
        # 打包后，资源在 _MEIPASS 目录
        base_path = sys._MEIPASS
    else:
        # 开发环境
        base_path = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_path, relative_path)


# 初始化 Flask 应用，使用正确的路径
template_folder = _get_resource_path(".")
static_folder = _get_resource_path("static")
APP = Flask(__name__, template_folder=template_folder, static_folder=static_folder)

#############################################
# 配置: settings.ini (仅使用 INI, 已彻底移除 settings.json 支持)
#############################################
_LOCK = threading.RLock()

# 注意：配置文件处理已移至 MusicPlayer 类


#############################################
# 创建全局播放器实例（从配置文件初始化）
#############################################

# 初始化播放器（使用 MusicPlayer.initialize() 处理所有初始化逻辑）
PLAYER = MusicPlayer.initialize(data_dir=".")

# 初始化多歌单管理器
PLAYLISTS_MANAGER = Playlists(data_file="playlists.json")

# 默认歌单 ID（不可删除）
DEFAULT_PLAYLIST_ID = "default"

# 当前活跃的歌单 ID
CURRENT_PLAYLIST_ID = DEFAULT_PLAYLIST_ID

# 用于向前端传递MUSIC_DIR的便利变量
PLAYLIST = []

# 播放队列和历史的便捷访问
PLAY_QUEUE = PLAYER.play_queue
PLAYBACK_HISTORY = PLAYER.playback_history

# 初始化默认歌单 =============
def _init_default_playlist():
    """初始化系统默认歌单"""
    global CURRENT_PLAYLIST_ID, PLAY_QUEUE
    
    # 检查默认歌单是否存在
    default_pl = PLAYLISTS_MANAGER.get_playlist(DEFAULT_PLAYLIST_ID)
    if not default_pl:
        # 创建默认歌单
        default_pl = PLAYLISTS_MANAGER.create_playlist("我的音乐")
        default_pl.id = DEFAULT_PLAYLIST_ID
        # 手动保存以确保 ID 被设置
        PLAYLISTS_MANAGER._playlists[DEFAULT_PLAYLIST_ID] = default_pl
        PLAYLISTS_MANAGER.save()
        print(f"[DEBUG] 创建默认歌单: {DEFAULT_PLAYLIST_ID}")
    
    CURRENT_PLAYLIST_ID = DEFAULT_PLAYLIST_ID
    
    # 从默认歌单加载歌曲到播放队列（如果队列为空）
    if default_pl and default_pl.songs and PLAY_QUEUE.is_empty():
        print(f"[DEBUG] 从默认歌单加载 {len(default_pl.songs)} 首歌曲到播放队列")
        PLAY_QUEUE.clear()
        for song_data in default_pl.songs:
            try:
                if isinstance(song_data, dict):
                    # 从dict重新构造song对象
                    song = Song.from_dict(song_data)
                    print(f"[DEBUG] 加载歌曲: {song.title} (类型: {song.type})")
                    PLAY_QUEUE.add(song)
                else:
                    # 兼容旧的字符串路径格式
                    song = LocalSong(file_path=song_data)
                    print(f"[DEBUG] 加载本地歌曲: {song_data}")
                    PLAY_QUEUE.add(song)
            except Exception as e:
                print(f"[WARN] 加载歌曲失败: {e}")
        PLAYER.save_play_queue()
    
    return default_pl

# 初始化默认歌单
_init_default_playlist()


# 便捷访问函数（简化代码）
def _get_current_index():
    return PLAYER.current_index


def _set_current_index(val):
    PLAYER.current_index = val


def _get_loop_mode():
    return PLAYER.loop_mode


# =========== MPV 启动 & IPC 包装函数 ===========
# 注意：MPV IPC 初始化已移至 MusicPlayer 类的 _init_mpv_ipc() 方法
# 以下函数为便捷包装，委托给 PLAYER 实例的方法


def mpv_pipe_exists() -> bool:
    """检查 MPV 管道是否存在"""
    return PLAYER.mpv_pipe_exists()


def ensure_mpv():
    """确保 MPV 进程运行"""
    return PLAYER.ensure_mpv()


def mpv_command(cmd_list):
    """向 MPV 发送命令"""
    return PLAYER.mpv_command(cmd_list)


def mpv_request(payload: dict):
    """向 MPV 发送请求"""
    return PLAYER.mpv_request(payload)


def mpv_get(prop: str):
    """获取 MPV 属性值"""
    return PLAYER.mpv_get(prop)


def mpv_set(prop: str, value):
    """设置 MPV 属性值"""
    return PLAYER.mpv_set(prop, value)


def add_to_playback_history(url_or_path: str, name: str, is_local: bool = False, thumbnail_url: str = None):
    """添加条目到播放历史"""
    return PLAYER.add_to_playback_history(url_or_path, name, is_local, thumbnail_url)


def _ensure_playlist(force: bool = False):
    """确保内存 PLAYLIST 存在; force=True 时强制重建."""
    global PLAYLIST
    if force or not PLAYLIST:
        PLAYLIST = PLAYER.build_playlist()
    return PLAYLIST


def _play_index(idx: int, save_history: bool = True):
    """播放播放列表中指定索引的本地文件（包装函数）"""
    return PLAYER.play_index(
        playlist=PLAYLIST,
        idx=idx,
        mpv_command_func=mpv_command,
        mpv_pipe_exists_func=mpv_pipe_exists,
        ensure_mpv_func=ensure_mpv,
        save_history=save_history,
    )


def _play_url(url: str, save_to_history: bool = True, update_queue: bool = True):
    """播放网络 URL（如 YouTube）（包装函数）

    参数:
      url: 要播放的 URL
      save_to_history: 是否保存该 URL 到历史记录
      update_queue: 是否更新播放队列
    """
    return PLAYER.play_url(
        url=url,
        mpv_command_func=mpv_command,
        mpv_pipe_exists_func=mpv_pipe_exists,
        ensure_mpv_func=ensure_mpv,
        mpv_get_func=mpv_get,
        save_to_history=save_to_history,
        update_queue=update_queue,
    )


def _next_track():
    """播放下一首歌曲（包装函数）"""
    return PLAYER.next_track(
        playlist=PLAYLIST,
        mpv_command_func=mpv_command,
        mpv_pipe_exists_func=mpv_pipe_exists,
        ensure_mpv_func=ensure_mpv,
    )


def _prev_track():
    """播放上一首歌曲（包装函数）"""
    return PLAYER.previous_track(
        playlist=PLAYLIST,
        mpv_command_func=mpv_command,
        mpv_pipe_exists_func=mpv_pipe_exists,
        ensure_mpv_func=ensure_mpv,
    )


def _play_song(song, save_to_history: bool = True):
    """统一的播放接口（包装函数）

    根据歌曲对象类型（本地或串流）调用相应的播放方法

    参数:
      song: Song 对象（LocalSong 或 StreamSong）
      save_to_history: 是否保存到播放历史

    返回:
      成功返回 True，失败返回 False
    """
    if not song:
        print(f"[ERROR] _play_song() 接收到 None")
        return False

    print(f"[DEBUG] _play_song() -> {song}")

    result = PLAYER.play(
        song=song,
        mpv_command_func=mpv_command,
        mpv_pipe_exists_func=mpv_pipe_exists,
        ensure_mpv_func=ensure_mpv,
        add_to_history_func=add_to_playback_history,
        save_to_history=save_to_history,
    )

    # 启动监控线程（如果还没启动）
    if result:
        _start_track_monitor()

    return result


# 注意：播放历史和播放队列已在 PLAYER 构造器中加载

# =========== 歌曲结束监控线程 ===========
_monitor_thread = None
_monitor_running = False


def _update_current_meta_and_fetch_title(song):
    """更新当前播放元数据，并为串流歌曲获取真实标题"""
    PLAYER.current_meta = song.to_dict()
    PLAYER._last_play_time = time.time()

    # 对于串流媒体，启动后台线程获取真实标题
    if song.is_stream():
        import threading

        def _fetch_title():
            import time

            def _is_valid_title(title, raw_url):
                """验证标题是否有效"""
                if not title or not isinstance(title, str):
                    return False
                s = title.strip()
                if not s or len(s) < 3:
                    return False
                # 拒绝包含URL特征的字符串
                if s.startswith("http") or "://" in s:
                    return False
                if raw_url and s == raw_url:
                    return False
                # 拒绝包含YouTube特征的字符串
                if "youtu" in s.lower() or "watch?" in s.lower():
                    return False
                # 拒绝看起来像视频ID的字符串（11位字母数字）
                if len(s) == 11 and all(c.isalnum() or c in ("-", "_") for c in s):
                    return False
                # 拒绝看起来像URL参数的字符串
                if "=" in s or "&" in s or "?" in s:
                    return False
                return True

            url = song.url
            for attempt in range(20):
                time.sleep(0.5)
                try:
                    media_title = mpv_get("media-title")
                    if _is_valid_title(media_title, url):
                        # 更新 current_meta
                        PLAYER.current_meta["media_title"] = media_title
                        PLAYER.current_meta["name"] = media_title

                        # 更新队列中的歌曲对象
                        song.title = media_title
                        PLAYER.save_play_queue()

                        print(
                            f"[DEBUG] 获取到串流标题 (尝试 {attempt+1}): {media_title}"
                        )

                        # 同步更新历史记录
                        if not PLAYER.playback_history.is_empty():
                            history = PLAYER.playback_history.get_all()
                            if history and history[0].get("url") == url:
                                PLAYER.playback_history.update_item(0, name=media_title)
                        break
                    else:
                        if attempt < 5:
                            print(
                                f"[DEBUG] 媒体标题无效 (尝试 {attempt+1}): {repr(media_title)}"
                            )
                except Exception as e:
                    if attempt == 19:
                        print(f"[WARN] 无法获取串流标题: {e}")

        threading.Thread(
            target=_fetch_title, daemon=True, name="FetchStreamTitle"
        ).start()


def _start_track_monitor():
    """启动歌曲结束监控线程"""
    global _monitor_thread, _monitor_running

    if _monitor_thread and _monitor_thread.is_alive():
        return  # 线程已在运行

    _monitor_running = True

    def _monitor_loop():
        """监控线程主循环：检测歌曲结束并触发自动播放"""
        import time

        grace_period_end = 0  # 宽限期结束时间
        check_count = 0
        last_logged_time = None

        while _monitor_running:
            try:
                time.sleep(0.5)  # 每 0.5 秒检查一次（更频繁）
                check_count += 1

                # 检查 MPV 是否在运行
                if not mpv_pipe_exists():
                    grace_period_end = 0
                    continue

                # 获取播放状态
                try:
                    time_pos = mpv_get("time-pos")
                    duration = mpv_get("duration")
                    eof_reached = mpv_get("eof-reached")
                    paused = mpv_get("pause")

                    # 仅每 20 次输出一次日志（避免刷屏）
                    should_log = check_count % 20 == 0
                    if should_log:
                        print(
                            f"[MONITOR] 监控中... time_pos={time_pos}, duration={duration}, eof={eof_reached}, paused={paused}"
                        )

                    if time_pos is None:
                        grace_period_end = 0
                        continue

                    # 检测歌曲是否刚开始播放（设置宽限期）
                    current_song = PLAY_QUEUE.get_current()
                    if current_song and time_pos < 3:
                        # 本地文件：2秒宽限期
                        # 流媒体：5秒宽限期
                        if grace_period_end == 0:
                            grace_period = 5 if current_song.is_stream() else 2
                            grace_period_end = time.time() + grace_period
                            if should_log:
                                print(
                                    f"[MONITOR] 歌曲刚开始，设置 {grace_period}s 宽限期"
                                )

                    # 在宽限期内不检测结束
                    if grace_period_end > 0 and time.time() < grace_period_end:
                        continue

                    # 检测歌曲结束：时长接近结束（即使 eof-reached 不可靠）
                    track_ended = False
                    if eof_reached:
                        track_ended = True
                        if should_log:
                            print(f"[MONITOR] eof-reached = true")
                    elif duration and duration > 0:
                        # 如果播放位置接近末尾（在最后 2 秒）
                        time_remaining = duration - time_pos
                        if time_remaining < 2 and time_remaining >= 0:
                            track_ended = True
                            if should_log:
                                print(f"[MONITOR] 接近末尾: {time_remaining:.2f}s 剩余")

                    if track_ended:
                        print(
                            f"[MONITOR] ======= 检测到歌曲结束 (time_pos={time_pos:.2f}, duration={duration:.2f}, eof={eof_reached}) ======="
                        )
                        grace_period_end = 0

                        # 调用播放器的 handle_track_end 方法
                        success = PLAYER.handle_track_end(
                            mpv_command_func=mpv_command,
                            mpv_pipe_exists_func=mpv_pipe_exists,
                            ensure_mpv_func=ensure_mpv,
                            add_to_history_func=add_to_playback_history,
                        )

                        # 如果成功播放了下一首，更新 current_meta
                        if success:
                            current_song = PLAY_QUEUE.get_current()
                            if current_song:
                                _update_current_meta_and_fetch_title(current_song)

                        # 等待一段时间再继续监控，避免重复触发
                        time.sleep(2)
                        grace_period_end = time.time() + 5

                except Exception as e:
                    # 记录获取属性时的错误
                    if should_log:
                        print(f"[DEBUG] Monitor 获取属性错误: {type(e).__name__}: {e}")
                    pass

            except Exception as e:
                print(f"[ERROR] 监控线程异常: {e}")
                import traceback

                traceback.print_exc()
                time.sleep(5)

    _monitor_thread = threading.Thread(
        target=_monitor_loop, daemon=True, name="TrackMonitor"
    )
    _monitor_thread.start()
    print("[INFO] 歌曲结束监控线程已启动")


# =========== 路由 ===========
@APP.route("/")
def index():
    tree = PLAYER.build_tree()
    return render_template("index.html", tree=tree, music_dir=PLAYER.music_dir)


@APP.route("/play", methods=["POST"])
def play_route():
    from flask import request

    # 支持 path（本地）或 url（串流）参数
    path = (request.form.get("path") or "").strip()
    url = (request.form.get("url") or "").strip()
    skip_history = (request.form.get("skip_history") or "").strip() in (
        "1",
        "true",
        "True",
    )
    # play_now: 是否立即播放（默认为 True）
    play_now = (request.form.get("play_now") or "1").strip() not in (
        "0",
        "false",
        "False",
    )
    # add_to_queue: 是否添加到队列末端（而不是替换整个队列，仅在 play_now=1 时有效）
    add_to_queue = (request.form.get("add_to_queue") or "").strip() in (
        "1",
        "true",
        "True",
    )
    # insert_front: 是否在当前播放歌曲之前插入（保持当前曲目之后的队列不变）
    insert_front = (request.form.get("insert_front") or "").strip() in (
        "1",
        "true",
        "True",
    )

    print(
        f"[PLAY API] 收到请求 - path={path}, url={url}, play_now={play_now}, add_to_queue={add_to_queue}"
    )

    def _insert_next(song_obj):
        """将歌曲插入到当前播放的下一首位置；若队列为空则添加为首项。"""
        if PLAY_QUEUE.is_empty():
            PLAY_QUEUE.add(song_obj)
            return PLAY_QUEUE.size() - 1
        current_idx = PLAY_QUEUE.get_current_index()
        insert_pos = (
            current_idx + 1
            if (isinstance(current_idx, int) and current_idx >= 0)
            else PLAY_QUEUE.size()
        )
        PLAY_QUEUE.insert(insert_pos, song_obj)
        return insert_pos

    def _insert_front(song_obj):
        """将歌曲插入到当前播放歌曲之前（若无当前则插入首位），并将当前索引指向该曲目。"""
        if PLAY_QUEUE.is_empty():
            PLAY_QUEUE.add(song_obj)
            PLAY_QUEUE.set_current_index(0)
            return 0
        current_idx = PLAY_QUEUE.get_current_index()
        insert_pos = current_idx if (isinstance(current_idx, int) and current_idx >= 0) else 0
        PLAY_QUEUE.insert(insert_pos, song_obj)
        PLAY_QUEUE.set_current_index(insert_pos)
        return insert_pos

    # 判断是本地文件还是串流URL
    if path:
        # 本地文件播放
        try:
            if not ensure_mpv():
                return jsonify({"status": "ERROR", "error": "mpv 启动失败"}), 400
            global PLAYLIST
            if not PLAYLIST or path not in PLAYLIST:
                print(f"[PLAY API] 重建PLAYLIST，当前path={path}")
                PLAYLIST = PLAYER.build_playlist()
            if path not in PLAYLIST:
                print(
                    f"[PLAY API] 文件不在列表中 - path={path}, PLAYLIST前5个项目:{PLAYLIST[:5]}"
                )
                return jsonify({"status": "ERROR", "error": "文件不在列表"}), 400
            idx = PLAYLIST.index(path)
            print(f"[PLAY API] 找到文件索引={idx}, 文件={path}")

            # 创建 LocalSong 对象
            song = LocalSong(file_path=path)

            # 根据 play_now 参数决定是否立即播放
            if play_now:
                if not _play_song(song, save_to_history=not skip_history):
                    return jsonify({"status": "ERROR", "error": "播放失败"}), 400
                PLAYER.current_index = idx
                if add_to_queue:
                    if insert_front:
                        _insert_front(song)
                    else:
                        _insert_next(song)
                else:
                    PLAY_QUEUE.clear()
                    PLAY_QUEUE.add(song)
                    PLAY_QUEUE.set_current_index(0)
                PLAYER.save_play_queue()
                return jsonify(
                    {"status": "OK", "rel": path, "index": idx, "total": len(PLAYLIST)}
                )
            else:
                queue_was_empty = PLAY_QUEUE.is_empty()
                insert_pos = _insert_next(song)
                PLAYER.save_play_queue()
                if queue_was_empty:
                    print(f"[QUEUE] 队列为空，立即播放新添加的本地歌曲: {song.title}")
                    success = PLAY_QUEUE.play_at_index(
                        index=insert_pos,
                        save_to_history=not skip_history,
                        mpv_command_func=mpv_command,
                        mpv_pipe_exists_func=mpv_pipe_exists,
                        ensure_mpv_func=ensure_mpv,
                        add_to_history_func=add_to_playback_history,
                        music_dir=PLAYER.music_dir,
                    )
                    if success:
                        PLAYER.current_index = idx
                        _update_current_meta_and_fetch_title(song)
                        PLAY_QUEUE.set_current_index(insert_pos)
                        return jsonify(
                            {
                                "status": "OK",
                                "message": "队列为空，已立即播放",
                                "queue_length": PLAY_QUEUE.size(),
                                "auto_played": True,
                            }
                        )
                    else:
                        return jsonify({"status": "ERROR", "error": "播放失败"}), 500
                else:
                    return jsonify(
                        {
                            "status": "OK",
                            "message": "已添加到队列",
                            "queue_length": PLAY_QUEUE.size(),
                            "auto_played": False,
                        }
                    )
        except Exception as e:
            return jsonify({"status": "ERROR", "error": str(e)}), 400

    elif url:
        # 串流URL播放
        if not url.startswith("http"):
            return jsonify({"status": "ERROR", "error": "非法的 url"}), 400
        try:
            if not ensure_mpv():
                return (
                    jsonify({"status": "ERROR", "error": "mpv 启动失败或未就绪"}),
                    500,
                )

            # 创建 StreamSong 对象
            song = StreamSong(stream_url=url, title="加载中…")

            # 根据 play_now 参数决定是否立即播放
            if play_now:
                print(f"[PLAY] 开始播放 URL: {url}")
                if not _play_song(song, save_to_history=not skip_history):
                    return jsonify({"status": "ERROR", "error": "播放失败"}), 500
                if add_to_queue:
                    if insert_front:
                        _insert_front(song)
                    else:
                        _insert_next(song)
                else:
                    PLAY_QUEUE.clear()
                    PLAY_QUEUE.add(song)
                    PLAY_QUEUE.set_current_index(0)
                PLAYER.save_play_queue()
                return jsonify({"status": "OK", "msg": "已开始播放", "url": url})
            else:
                queue_was_empty = PLAY_QUEUE.is_empty()
                print(
                    f"[PLAY] 添加 URL 到下一首位置: {url}, queue_was_empty={queue_was_empty}"
                )
                insert_pos = _insert_next(song)
                PLAYER.save_play_queue()
                if queue_was_empty:
                    print(f"[QUEUE] 队列为空，立即播放新添加的流媒体: {song.title}")
                    success = PLAY_QUEUE.play_at_index(
                        index=insert_pos,
                        save_to_history=not skip_history,
                        mpv_command_func=mpv_command,
                        mpv_pipe_exists_func=mpv_pipe_exists,
                        ensure_mpv_func=ensure_mpv,
                        add_to_history_func=add_to_playback_history,
                        music_dir=PLAYER.music_dir,
                    )
                    if success:
                        PLAYER.current_index = -1
                        _update_current_meta_and_fetch_title(song)
                        PLAY_QUEUE.set_current_index(insert_pos)
                        return jsonify(
                            {
                                "status": "OK",
                                "message": "队列为空，已立即播放",
                                "queue_length": PLAY_QUEUE.size(),
                                "auto_played": True,
                            }
                        )
                    else:
                        return jsonify({"status": "ERROR", "error": "播放失败"}), 500
                else:
                    return jsonify(
                        {
                            "status": "OK",
                            "message": "已添加到队列",
                            "queue_length": PLAY_QUEUE.size(),
                            "auto_played": False,
                        }
                    )
        except Exception as e:
            print(f"[ERROR] 播放 URL 异常: {e}")
            import traceback

            traceback.print_exc()
            return jsonify({"status": "ERROR", "error": str(e)}), 500

    else:
        return jsonify({"status": "ERROR", "error": "缺少 path 或 url 参数"}), 400


@APP.route("/tree")
def tree_json():
    return jsonify({"status": "OK", "tree": PLAYER.build_tree()})


@APP.route("/next", methods=["POST"])
def api_next():
    if not ensure_mpv():
        return jsonify({"status": "ERROR", "error": "mpv 未就绪"}), 400
    if _next_track():
        return jsonify(
            {
                "status": "OK",
                "rel": PLAYLIST[CURRENT_INDEX],
                "index": CURRENT_INDEX,
                "total": len(PLAYLIST),
            }
        )
    return jsonify({"status": "ERROR", "error": "没有下一首"}), 400


@APP.route("/prev", methods=["POST"])
def api_prev():
    if not ensure_mpv():
        return jsonify({"status": "ERROR", "error": "mpv 未就绪"}), 400
    if _prev_track():
        return jsonify(
            {
                "status": "OK",
                "rel": PLAYLIST[CURRENT_INDEX],
                "index": CURRENT_INDEX,
                "total": len(PLAYLIST),
            }
        )
    return jsonify({"status": "ERROR", "error": "没有上一首"}), 400


@APP.route("/status")
def api_status():
    """返回当前播放状态（仅内存），所有客户端轮询实现共享可见性。"""
    playing = PLAYER.current_meta if PLAYER.current_meta else {}
    mpv_info = {}
    # 仅在 mpv 管道可用时尝试获取实时播放属性
    try:
        with open(PLAYER.pipe_name, "wb") as _:
            try:
                pos = mpv_get("time-pos")
                dur = mpv_get("duration")
                paused = mpv_get("pause")
                vol = PLAYER.get_volume()
                mpv_info = {
                    "time": pos,
                    "duration": dur,
                    "paused": paused,
                    "volume": vol,
                }

            except Exception:
                pass
    except Exception:
        pass
    # 计算一个服务器端的友好显示名，优先使用 mpv 的 media-title
    try:
        pd = {}
        pd.update(playing or {})
        media_title = pd.get("media_title") or pd.get("mediaTitle")
        name_field = pd.get("name") or pd.get("rel") or ""

        # 简单校验 media_title，避免使用看起来像 URL 或视频 ID 的值
        def _valid_title(t, raw):
            try:
                if not t or not isinstance(t, str):
                    return False
                s = t.strip()
                if not s:
                    return False
                if s.startswith("http"):
                    return False
                if raw and s == raw:
                    return False
                if "youtu" in s.lower():
                    return False
                if len(s) == 11 and all(c.isalnum() or c in ("-", "_") for c in s):
                    return False
                return True
            except Exception:
                return False

        if _valid_title(media_title, pd.get("raw_url")):
            pd["display_name"] = media_title
        else:
            # 如果 name 看起来像 URL，则返回加载占位；否则使用 name
            try:
                if isinstance(name_field, str) and name_field.startswith("http"):
                    pd["display_name"] = "加载中…"
                else:
                    pd["display_name"] = name_field or "未播放"
            except Exception:
                pd["display_name"] = name_field or "未播放"
    except Exception:
        pd = playing
        pd["display_name"] = pd.get("name") if pd else "未播放"
    return jsonify({"status": "OK", "playing": pd, "mpv": mpv_info})


@APP.route("/loop", methods=["POST"])
def api_loop():
    """循环模式切换: 0=不循环, 1=单曲循环, 2=全部循环"""
    PLAYER.loop_mode = (PLAYER.loop_mode + 1) % 3
    return jsonify({"status": "OK", "loop_mode": PLAYER.loop_mode})


@APP.route("/playlist")
def api_playlist():
    """返回当前播放列表。

    参数:
      rebuild=1  强制重建扫描
      offset, limit  分页 (可选)
    """
    from flask import request

    force = request.args.get("rebuild") == "1"
    plist = _ensure_playlist(force)
    offset = int(request.args.get("offset", "0") or 0)
    limit = request.args.get("limit")
    if limit is not None:
        try:
            limit_i = max(0, int(limit))
        except ValueError:
            limit_i = 0
    else:
        limit_i = 0
    data = plist
    if offset < 0:
        offset = 0
    if limit_i > 0:
        data = plist[offset : offset + limit_i]
    return jsonify(
        {
            "status": "OK",
            "total": len(plist),
            "index": CURRENT_INDEX,
            "current": CURRENT_META.get("rel") if CURRENT_META else None,
            "offset": offset,
            "limit": limit_i or None,
            "playlist": data,
        }
    )


@APP.route("/local_queue")
def api_local_queue():
    """返回本地播放队列（播放历史中的本地文件）

    显示用户播放过的本地音乐记录，格式与 YouTube 队列兼容
    """
    # 从 PLAYBACK_HISTORY 中筛选本地文件
    local_queue_items = []
    current_local_index = -1

    for idx, item in enumerate(PLAYBACK_HISTORY.get_all()):
        if item.get("type") == "local":
            # 保留所有字段，但确保有title字段
            item_dict = item.copy()
            if "title" not in item_dict and "name" in item_dict:
                item_dict["title"] = item_dict["name"]
            elif "name" not in item_dict and "title" in item_dict:
                item_dict["name"] = item_dict["title"]
            local_queue_items.append(item_dict)
        # 检查是否为当前播放的本地文件
        if (
            _get_current_index() >= 0
            and PLAYLIST
            and _get_current_index() < len(PLAYLIST)
        ):
            current_rel = PLAYLIST[_get_current_index()]
            if item["url"] == current_rel:
                current_local_index = len(local_queue_items) - 1

    return jsonify(
        {
            "status": "OK",
            "queue": local_queue_items,
            "current_index": current_local_index,
            "current_title": (
                local_queue_items[current_local_index]["title"]
                if 0 <= current_local_index < len(local_queue_items)
                else None
            ),
        }
    )


@APP.route("/combined_queue")
def api_combined_queue():
    """返回播放队列

    仅返回当前的播放队列，不包括历史记录
    """
    combined_queue = []
    current_combined_index = -1
    youtube_count = 0

    # 使用面向对象队列
    if not PLAY_QUEUE.is_empty():
        for idx, song in enumerate(PLAY_QUEUE.get_all()):
            song_dict = song.to_dict()
            song_dict["in_queue"] = True
            combined_queue.append(song_dict)
            if song.is_stream():
                youtube_count += 1

            # 检查是否为当前播放项
            if idx == PLAY_QUEUE.get_current_index() and current_combined_index == -1:
                current_combined_index = idx
            elif current_combined_index == -1:
                # 通过URL匹配检查
                if song.is_stream():
                    current_raw_url = (
                        PLAYER.current_meta.get("raw_url")
                        or PLAYER.current_meta.get("url")
                        if PLAYER.current_meta
                        else None
                    )
                    if current_raw_url and song.url == current_raw_url:
                        current_combined_index = idx
                else:
                    current_rel = (
                        PLAYER.current_meta.get("rel") if PLAYER.current_meta else None
                    )
                    if current_rel and song.url == current_rel:
                        current_combined_index = idx

    # 构建响应数据
    return jsonify(
        {
            "status": "OK",
            "queue": combined_queue,
            "current_index": current_combined_index,
            "current_title": (
                combined_queue[current_combined_index]["title"]
                if 0 <= current_combined_index < len(combined_queue)
                else None
            ),
            "youtube_count": youtube_count,
        }
    )


@APP.route("/debug/mpv")
def api_debug_mpv():
    info = {
        "MPV_CMD": PLAYER.mpv_cmd,
        "PIPE_NAME": PLAYER.pipe_name,
        "pipe_exists": mpv_pipe_exists(),
        "playlist_len": len(PLAYLIST),
        "current_index": _get_current_index(),
    }
    return jsonify({"status": "OK", "info": info})


@APP.route("/preview.png")
def preview_image():
    """Serve a static preview image or a simple placeholder.

    This endpoint no longer generates an image from site content. It first tries
    to serve `static/preview.png` (use this to provide a custom image). If not
    present, it returns a simple neutral placeholder PNG generated in-memory.
    """
    from flask import send_file, abort
    from io import BytesIO

    try:
        static_path = os.path.join(_get_app_dir(), "static", "preview.png")
        if os.path.isfile(static_path):
            return send_file(
                static_path,
                mimetype="image/png",
                as_attachment=False,
                download_name="preview.png",
            )
        # Fallback: generate a minimal placeholder (does not use site content)
        try:
            from PIL import Image

            width, height = 1200, 630
            img = Image.new("RGB", (width, height), color=(36, 37, 41))
            bio = BytesIO()
            img.save(bio, format="PNG")
            bio.seek(0)
            resp = send_file(
                bio,
                mimetype="image/png",
                as_attachment=False,
                download_name="preview.png",
            )
            # Short cache for the placeholder
            resp.headers["Cache-Control"] = "public, max-age=3600"
            return resp
        except Exception:
            # If PIL is not available, return 204 No Content
            return ("", 204)
    except Exception as e:
        print(f"[ERROR] preview_image failed: {e}")
        return ("", 500)


@APP.route("/volume", methods=["POST"])
def api_volume():
    from flask import request

    # form: value 可选(0-100). 不提供则返回当前音量
    if not ensure_mpv():
        return jsonify({"status": "ERROR", "error": "mpv 未就绪"}), 400

    val = request.form.get("value")
    if val is None or val == "":
        # 获取当前音量
        cur = PLAYER.get_volume()
        return jsonify({"status": "OK", "volume": cur})

    try:
        f = float(val)
    except ValueError:
        return jsonify({"status": "ERROR", "error": "数值非法"}), 400

    # 设置音量（范围检查由 set_volume 方法完成）
    if not PLAYER.set_volume(f):
        return jsonify({"status": "ERROR", "error": "设置失败"}), 400

    return jsonify({"status": "OK", "volume": f})


@APP.route("/seek", methods=["POST"])
def api_seek():
    """跳转到指定播放位置
    参数: percent (0-100) 表示播放进度的百分比
    """
    from flask import request

    if not ensure_mpv():
        return jsonify({"status": "ERROR", "error": "mpv 未就绪"}), 400

    percent_str = request.form.get("percent")
    if not percent_str:
        return jsonify({"status": "ERROR", "error": "缺少 percent 参数"}), 400

    try:
        percent = float(percent_str)
    except ValueError:
        return jsonify({"status": "ERROR", "error": "percent 参数非法"}), 400

    # 使用播放器的 seek 方法
    if not PLAYER.seek(percent):
        return jsonify({"status": "ERROR", "error": "跳转失败"}), 400

    return jsonify({"status": "OK", "percent": percent})


@APP.route("/toggle_pause", methods=["POST"])
def api_toggle_pause():
    """切换暂停/播放状态"""
    if not ensure_mpv():
        return jsonify({"status": "ERROR", "error": "mpv 未就绪"}), 400

    # 使用播放器的 toggle_pause 方法
    if not PLAYER.toggle_pause():
        return jsonify({"status": "ERROR", "error": "切换失败"}), 400

    # 获取当前暂停状态
    paused = PLAYER.get_pause_state()
    return jsonify({"status": "OK", "paused": paused})


@APP.route("/ensure_playing", methods=["POST"])
def api_ensure_playing():
    """确保播放（如果暂停则恢复播放）"""
    if not ensure_mpv():
        return jsonify({"status": "ERROR", "error": "mpv 未就绪"}), 400

    try:
        # 获取当前暂停状态
        paused = PLAYER.get_pause_state()
        if paused:
            # 如果是暂停状态，则恢复播放
            PLAYER.toggle_pause()
            print("[PLAY] 恢复播放")
        return jsonify({"status": "OK", "paused": False})
    except Exception as e:
        print(f"[ERROR] 确保播放失败: {e}")
        return jsonify({"status": "ERROR", "error": str(e)}), 500


@APP.route("/play_youtube", methods=["POST"])
def api_play_youtube():
    """播放 YouTube 链接（委托给统一的 /play 接口）

    请求参数：url（必需）
    """
    from flask import request, jsonify

    url = (request.form.get("url") or "").strip()
    if not url or not url.startswith("http"):
        return jsonify({"status": "ERROR", "error": "缺少或非法的 url"}), 400
    try:
        # 直接调用统一的播放方法
        if not ensure_mpv():
            return jsonify({"status": "ERROR", "error": "mpv 启动失败或未就绪"}), 500

        print(f"[YOUTUBE] 开始播放 YouTube 链接: {url}")

        # 创建 StreamSong 对象并播放
        song = StreamSong(stream_url=url, title="加载中…")
        if not _play_song(song, save_to_history=True):
            return jsonify({"status": "ERROR", "error": "播放失败"}), 500

        return jsonify({"status": "OK", "msg": "已开始流式播放", "url": url})
    except Exception as e:
        print(f"[ERROR] 播放 YouTube 异常: {e}")
        import traceback

        traceback.print_exc()
        return jsonify({"status": "ERROR", "error": str(e)}), 500


@APP.route("/play_youtube_queue", methods=["POST"])
def api_play_youtube_queue():
    """播放 YouTube 链接，保留当前播放队列（从历史记录播放时使用）。
    请求参数：url（必需）
    """
    from flask import request, jsonify

    url = (request.form.get("url") or "").strip()
    if not url or not url.startswith("http"):
        return jsonify({"status": "ERROR", "error": "缺少或非法的 url"}), 400
    try:
        # 确保 mpv 就绪
        if not ensure_mpv():
            return jsonify({"status": "ERROR", "error": "mpv 启动失败或未就绪"}), 500
        # 使用 _play_url 播放，但不更新队列（保留现有队列）
        print(f"[YOUTUBE] 从历史记录播放 YouTube 链接（保留队列）: {url}")
        _play_url(url, save_to_history=True, update_queue=False)
        return jsonify(
            {
                "status": "OK",
                "msg": "已开始流式播放 (mpv ytdl-format=bestaudio)",
                "url": url,
            }
        )
    except Exception as e:
        print(f"[ERROR] 播放 YouTube 异常: {e}")
        import traceback

        traceback.print_exc()
        return jsonify({"status": "ERROR", "error": str(e)}), 500


@APP.route("/youtube_queue")
def api_youtube_queue():
    """返回当前播放队列。

    返回:
      queue  当前播放列表的所有项目
      current_index  当前播放的索引
      current_title  当前播放的标题
    """
    queue_items = PLAY_QUEUE.get_all()
    current_index = PLAY_QUEUE.get_current_index()
    current_title = None

    if 0 <= current_index < len(queue_items):
        current_song = queue_items[current_index]
        current_title = current_song.title

    return jsonify(
        {
            "status": "OK",
            "queue": [song.to_dict() for song in queue_items],
            "current_index": current_index,
            "current_title": current_title,
        }
    )


@APP.route("/youtube_queue_play", methods=["POST"])
def api_youtube_queue_play():
    """播放队列中指定索引的歌曲（支持 YouTube 与本地）。

    参数:
      index  要播放的队列索引
    """
    from flask import request

    try:
        index = int(request.form.get("index", -1))
    except (ValueError, TypeError):
        return jsonify({"status": "ERROR", "error": "索引参数非法"}), 400

    if PLAY_QUEUE.is_empty() or index < 0 or index >= PLAY_QUEUE.size():
        return jsonify({"status": "ERROR", "error": "索引超出范围"}), 400

    try:
        # 使用队列的播放方法，自动处理两种歌曲类型
        success = PLAY_QUEUE.play_at_index(
            index=index,
            save_to_history=True,
            mpv_command_func=mpv_command,
            mpv_pipe_exists_func=mpv_pipe_exists,
            ensure_mpv_func=ensure_mpv,
            add_to_history_func=add_to_playback_history,
            music_dir=PLAYER.music_dir,
        )

        if not success:
            return jsonify({"status": "ERROR", "error": "播放失败"}), 500

        song = PLAY_QUEUE.get_all()[index]
        title = song.title

        # 更新播放器当前状态并获取串流标题
        _update_current_meta_and_fetch_title(song)
        _start_track_monitor()
        PLAYER.save_play_queue()

        return jsonify({"status": "OK", "current_index": index, "current_title": title})
    except Exception as e:
        print(f"[ERROR] 播放队列中的歌曲失败: {e}")
        return jsonify({"status": "ERROR", "error": str(e)}), 500


@APP.route("/play_queue_clear", methods=["POST"])
@APP.route("/play_queue_clear", methods=["POST"])
def api_play_queue_clear():
    """清空当前播放队列（调用 PlayQueue.clear_queue() 方法）"""
    try:
        # 清空播放队列
        PLAY_QUEUE.clear_queue()
        PLAYER.save_play_queue()

        # 停止当前播放
        print("[QUEUE] 清空播放队列，停止当前播放")
        if mpv_pipe_exists():
            mpv_command(["stop"])

        return jsonify({"status": "OK", "message": "队列已清空，播放已停止"})
    except Exception as e:
        print(f"[ERROR] 清空队列失败: {e}")
        return jsonify({"status": "ERROR", "error": str(e)}), 500


@APP.route("/youtube_queue_clear", methods=["POST"])
def api_youtube_queue_clear():
    """清空当前播放队列（别名到 /play_queue_clear）"""
    return api_play_queue_clear()


@APP.route("/youtube_queue_add", methods=["POST"])
@APP.route("/youtube_queue_add", methods=["POST"])
def api_youtube_queue_add():
    """添加条目到播放队列（支持 YouTube 与本地）

    参数:
      url    要添加的URL或本地相对路径（必需）
      title  标题（可选）
      type   条目类型：youtube/local，默认 youtube

    行为:
      - 如果队列为空，立即播放该条目
      - 如果队列非空，将条目添加到队列末尾
    """
    from flask import request

    url = (request.form.get("url") or "").strip()
    title = (request.form.get("title") or "").strip()
    item_type = (request.form.get("type") or "youtube").strip().lower()

    if not url:
        return jsonify({"status": "ERROR", "error": "缺少 url 参数"}), 400
    if item_type not in ("youtube", "local"):
        item_type = "youtube"

    try:
        # 检查队列是否为空
        queue_was_empty = PLAY_QUEUE.is_empty()

        # 使用面向对象的方式创建歌曲对象
        if item_type == "local":
            song = LocalSong(file_path=url, title=title)
        else:
            song = StreamSong(stream_url=url, title=title, stream_type=item_type)

        # 添加到队列 - 如果队列非空，插入到当前播放歌曲的下一首位置
        if queue_was_empty:
            PLAY_QUEUE.add(song)
        else:
            # 获取当前播放歌曲的索引，插入到下一首位置
            current_index = PLAY_QUEUE.get_current_index()
            insert_position = (
                current_index + 1 if current_index >= 0 else PLAY_QUEUE.size()
            )
            PLAY_QUEUE.insert(insert_position, song)

        # 保存队列到文件
        PLAYER.save_play_queue()

        print(
            f"[DEBUG] 已添加到队列: {song.title} (type={item_type}, queue_was_empty={queue_was_empty})"
        )

        # 如果队列之前为空，现在立即播放这个歌曲
        if queue_was_empty:
            print(f"[QUEUE] 队列为空，立即播放新添加的歌曲: {song.title}")
            # 播放队列中的最后一项（刚添加的）
            last_index = PLAY_QUEUE.size() - 1
            success = PLAY_QUEUE.play_at_index(
                index=last_index,
                save_to_history=True,
                mpv_command_func=mpv_command,
                mpv_pipe_exists_func=mpv_pipe_exists,
                ensure_mpv_func=ensure_mpv,
                add_to_history_func=add_to_playback_history,
                music_dir=PLAYER.music_dir,
            )

            if success:
                # 同步播放器状态（流媒体没有本地播放列表索引）
                PLAYER.current_index = -1 if song.is_stream() else PLAYER.current_index
                _update_current_meta_and_fetch_title(song)
                PLAY_QUEUE.set_current_index(last_index)
                _start_track_monitor()
                return jsonify(
                    {
                        "status": "OK",
                        "queue_length": PLAY_QUEUE.size(),
                        "msg": "队列为空，已立即播放",
                        "auto_played": True,
                    }
                )
            else:
                return jsonify({"status": "ERROR", "error": "播放失败"}), 500
        else:
            # 队列非空，已插入到当前播放歌曲的下一首位置
            return jsonify(
                {
                    "status": "OK",
                    "queue_length": PLAY_QUEUE.size(),
                    "msg": "已添加为下一首播放",
                    "auto_played": False,
                }
            )
    except Exception as e:
        print(f"[ERROR] 添加歌曲到队列失败: {e}")
        import traceback

        traceback.print_exc()
        return jsonify({"status": "ERROR", "error": str(e)}), 500


@APP.route("/play_queue_remove", methods=["POST"])
@APP.route("/youtube_queue_remove", methods=["POST"])
def api_play_queue_remove():
    """从播放队列删除指定索引的条目"""
    from flask import request

    try:
        idx = int(request.form.get("index", -1))
    except (TypeError, ValueError):
        return jsonify({"status": "ERROR", "error": "索引参数非法"}), 400

    if idx < 0 or idx >= PLAY_QUEUE.size():
        return jsonify({"status": "ERROR", "error": "索引越界"}), 400

    removed_song = PLAY_QUEUE.get_item(idx)
    removed_title = getattr(removed_song, "title", "") or ""

    PLAY_QUEUE.remove(idx)
    PLAYER.save_play_queue()

    # 如果队列为空，尝试停止当前播放
    if PLAY_QUEUE.is_empty():
        try:
            if mpv_pipe_exists():
                mpv_command(["stop"])
        except Exception:
            pass

    return jsonify(
        {
            "status": "OK",
            "removed_index": idx,
            "removed_title": removed_title,
            "queue_length": PLAY_QUEUE.size(),
        }
    )


@APP.route("/queue_next", methods=["POST"])
def api_queue_next():
    """播放队列中的下一首歌曲"""
    if PLAY_QUEUE.is_empty():
        # If queue is empty, try the local playlist
        if not ensure_mpv():
            return jsonify({"status": "ERROR", "error": "mpv 未就绪"}), 400
        if _next_track():
            return jsonify({"status": "OK"})
        return jsonify({"status": "ERROR", "error": "没有下一首"}), 400

    try:
        # Get current index
        current_idx = PLAY_QUEUE.get_current_index()
        next_idx = current_idx + 1

        # Check if there's a next song
        if next_idx >= PLAY_QUEUE.size():
            return jsonify({"status": "ERROR", "error": "已到达队列末尾"}), 400

        # Play the next song
        success = PLAY_QUEUE.play_at_index(
            index=next_idx,
            save_to_history=True,
            mpv_command_func=mpv_command,
            mpv_pipe_exists_func=mpv_pipe_exists,
            ensure_mpv_func=ensure_mpv,
            add_to_history_func=add_to_playback_history,
            music_dir=PLAYER.music_dir,
        )

        if not success:
            return jsonify({"status": "ERROR", "error": "播放失败"}), 500

        song = PLAY_QUEUE.get_all()[next_idx]
        _update_current_meta_and_fetch_title(song)
        _start_track_monitor()
        PLAYER.save_play_queue()

        return jsonify(
            {"status": "OK", "current_index": next_idx, "current_title": song.title}
        )
    except Exception as e:
        print(f"[ERROR] 队列下一首失败: {e}")
        import traceback

        traceback.print_exc()
        return jsonify({"status": "ERROR", "error": str(e)}), 500


@APP.route("/play_queue_sort", methods=["POST"])
def api_play_queue_sort():
    """对播放队列进行排序（改变队列项目顺序）

    参数:
      sort_by: 排序方式
              - 'add_order': 按添加顺序（默认）
              - 'current_first': 当前播放的歌曲优先（置顶）
              - 'type': 按歌曲类型排序（本地在前，串流在后）
      reverse: 是否反向排序 (0/false=否, 1/true=是)
    """
    from flask import request

    if PLAY_QUEUE.is_empty():
        return jsonify({"status": "ERROR", "error": "队列为空"}), 400

    try:
        sort_by = (request.form.get("sort_by") or "add_order").strip().lower()
        reverse_str = (request.form.get("reverse") or "0").strip()
        reverse = reverse_str in ("1", "true", "True")

        # 验证 sort_by 参数
        if sort_by not in ("add_order", "current_first", "type"):
            sort_by = "add_order"  # 默认按添加顺序排序

        # 调用播放队列的排序方法
        PLAY_QUEUE.sort_queue(sort_by=sort_by, reverse=reverse)

        # 保存队列到文件
        PLAYER.save_play_queue()

        print(f"[DEBUG] 播放队列已排序: sort_by={sort_by}, reverse={reverse}")
        return jsonify(
            {
                "status": "OK",
                "message": "队列已排序",
                "sort_by": sort_by,
                "reverse": reverse,
                "queue_length": PLAY_QUEUE.size(),
                "queue": [song.to_dict() for song in PLAY_QUEUE.get_all()],
            }
        )
    except Exception as e:
        print(f"[ERROR] 播放队列排序失败: {e}")
        import traceback

        traceback.print_exc()
        return jsonify({"status": "ERROR", "error": str(e)}), 500


@APP.route("/youtube_queue_sort", methods=["POST"])
def api_youtube_queue_sort():
    """对播放队列进行排序（别名到 /play_queue_sort）"""
    return api_play_queue_sort()


@APP.route("/youtube_history")
def api_youtube_history():
    """返回 YouTube 播放历史记录。

    参数:
      limit  返回最多多少条记录（默认 20，最大 100）
    """
    from flask import request

    limit = min(int(request.args.get("limit", 50)), 100)
    return jsonify({"status": "OK", "history": PLAYBACK_HISTORY.get_all()[:limit]})


@APP.route("/playback_history")
def api_playback_history():
    """返回完整的播放历史记录（包含本地和YouTube）
    
    用于排行榜等功能
    """
    return jsonify({"status": "OK", "items": PLAYBACK_HISTORY.get_all()})


#############################################
# 统一的播放队列 API（别名）
#############################################
@APP.route("/play_queue")
def api_play_queue():
    """统一的播放队列 API（别名到 /youtube_queue）"""
    return api_youtube_queue()


@APP.route("/play_queue_play", methods=["POST"])
def api_play_queue_play():
    """统一的播放队列播放 API（别名到 /youtube_queue_play）"""
    return api_youtube_queue_play()


@APP.route("/play_queue_add", methods=["POST"])
def api_play_queue_add():
    """统一的播放队列添加 API（别名到 /youtube_queue_add）"""
    return api_youtube_queue_add()


@APP.route("/play_queue_reorder", methods=["POST"])
def api_play_queue_reorder():
    """统一的播放队列重排序 API（调用 PlayQueue.reorder() 方法）

    参数:
      from_index  源位置索引
      to_index    目标位置索引
    """
    from flask import request

    if PLAY_QUEUE.is_empty():
        return jsonify({"status": "ERROR", "error": "队列为空"}), 400

    try:
        from_index = int(request.form.get("from_index", -1))
        to_index = int(request.form.get("to_index", -1))
    except (ValueError, TypeError):
        return jsonify({"status": "ERROR", "error": "索引参数非法"}), 400

    if from_index < 0 or from_index >= PLAY_QUEUE.size():
        return jsonify({"status": "ERROR", "error": "from_index 超出范围"}), 400

    if to_index < 0 or to_index > PLAY_QUEUE.size():
        return jsonify({"status": "ERROR", "error": "to_index 超出范围"}), 400

    try:
        # 使用队列的重排序方法
        PLAY_QUEUE.reorder(from_index, to_index)

        # 保存队列到文件
        PLAYER.save_play_queue()

        print(f"[DEBUG] 队列重排序完成: {from_index} -> {to_index}")
        return jsonify(
            {
                "status": "OK",
                "message": "队列已重排序",
                "current_index": PLAY_QUEUE.get_current_index(),
            }
        )
    except Exception as e:
        print(f"[ERROR] 队列重排序失败: {e}")
        return jsonify({"status": "ERROR", "error": str(e)}), 500


@APP.route("/youtube_queue_reorder", methods=["POST"])
def api_youtube_queue_reorder():
    """播放队列重排序（别名到 /play_queue_reorder）"""
    return api_play_queue_reorder()


@APP.route("/youtube_extract_playlist", methods=["POST"])
def api_youtube_extract_playlist():
    """提取 YouTube 播放列表中的所有视频（包装函数）

    参数:
      url  播放列表 URL

    返回:
      entries  播放列表中的所有视频列表
    """
    from flask import request
    from models.song import StreamSong

    url = request.form.get("url", "").strip()
    result = StreamSong.extract_playlist(url)
    return jsonify(result)


@APP.route("/search_youtube", methods=["POST"])
def api_search_youtube():
    """搜索 YouTube 视频（包装函数）

    参数:
      query  搜索关键字
    """
    from flask import request
    from models.song import StreamSong

    query = request.form.get("query", "").strip()
    result = StreamSong.search(query)
    return jsonify(result)


def search_local_songs(query: str) -> list:
    """本地歌曲搜索功能
    
    参数:
      query - 搜索关键词
    
    返回:
      搜索结果列表
    """
    try:
        # 从默认歌单获取所有歌曲
        if CURRENT_PLAYLIST_ID not in PLAYLISTS_MANAGER._playlists:
            return []
        
        current_playlist = PLAYLISTS_MANAGER._playlists[CURRENT_PLAYLIST_ID]
        results = []
        query_lower = query.lower()
        
        for song_data in current_playlist.songs:
            # 支持dict和Song对象
            if isinstance(song_data, dict):
                title = song_data.get('title', '').lower()
                artist = song_data.get('artist', '').lower()
                song_type = song_data.get('type', '')
            else:
                title = song_data.title.lower()
                artist = getattr(song_data, 'artist', '').lower()
                song_type = song_data.type
            
            # 只搜索本地歌曲
            if song_type != 'local':
                continue
            
            # 按标题或艺术家匹配
            if query_lower in title or query_lower in artist:
                results.append({
                    'title': song_data.get('title', '') if isinstance(song_data, dict) else song_data.title,
                    'artist': song_data.get('artist', '本地音乐') if isinstance(song_data, dict) else getattr(song_data, 'artist', '本地音乐'),
                    'url': song_data.get('url', '') if isinstance(song_data, dict) else song_data.url,
                    'type': 'local',
                    'thumbnail': '🎵'
                })
        
        return results
    
    except Exception as e:
        print(f"[ERROR] 本地搜索失败: {e}")
        return []


@APP.route("/search_song", methods=["POST"])
def api_search_song():
    """统一搜索接口 - 支持 YouTube 和本地音乐搜索
    
    参数:
      query    - 搜索关键词（必需）
      type     - 搜索类型: 'youtube'(YouTube)、'local'(本地)、'all'(同时搜索)
                默认为 'youtube'
    
    返回:
      status: 'OK' 或 'ERROR'
      type: 搜索类型
      results: 搜索结果列表
    """
    from flask import request
    from models.song import StreamSong
    
    query = request.form.get('query', '').strip()
    search_type = request.form.get('type', 'youtube').lower()
    
    if not query:
        return jsonify({
            "status": "ERROR",
            "error": "搜索关键词不能为空"
        }), 400
    
    try:
        if search_type == 'youtube':
            # 搜索 YouTube
            result = StreamSong.search(query)
            return jsonify({
                "status": "OK",
                "type": "youtube",
                "results": result.get('results', []),
                "message": result.get('message', '')
            })
        
        elif search_type == 'local':
            # 搜索本地音乐
            results = search_local_songs(query)
            return jsonify({
                "status": "OK",
                "type": "local",
                "results": results
            })
        
        elif search_type == 'all':
            # 同时搜索 YouTube 和本地
            yt_result = StreamSong.search(query)
            local_results = search_local_songs(query)
            
            return jsonify({
                "status": "OK",
                "type": "mixed",
                "youtube": yt_result.get('results', []),
                "local": local_results,
                "youtube_message": yt_result.get('message', '')
            })
        
        else:
            return jsonify({
                "status": "ERROR",
                "error": f"不支持的搜索类型: {search_type}。支持: youtube, local, all"
            }), 400
    
    except Exception as e:
        print(f"[ERROR] 搜索失败: {e}")
        return jsonify({
            "status": "ERROR",
            "error": str(e)
        }), 500


# ============= 多歌单管理 API =============

@APP.route("/playlists", methods=["GET"])
def api_get_playlists():
    """获取所有歌单列表"""
    playlists_list = PLAYLISTS_MANAGER.get_all_dicts()
    return jsonify({
        "playlists": playlists_list,
        "current_playlist_id": CURRENT_PLAYLIST_ID,
        "default_playlist_id": DEFAULT_PLAYLIST_ID
    })


@APP.route("/playlists", methods=["POST"])
def api_create_playlist():
    """创建新歌单"""
    data = request.get_json()
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "歌单名称不能为空"}), 400

    try:
        new_playlist = PLAYLISTS_MANAGER.create_playlist(name)
        return jsonify(new_playlist.to_dict())
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@APP.route("/playlists/<playlist_id>", methods=["GET"])
def api_get_playlist(playlist_id):
    """获取指定歌单详情"""
    playlist = PLAYLISTS_MANAGER.get_playlist(playlist_id)
    if playlist:
        return jsonify(playlist.to_dict())
    return jsonify({"error": "歌单不存在"}), 404


@APP.route("/playlists/<playlist_id>", methods=["PUT"])
def api_update_playlist(playlist_id):
    """更新歌单信息（名称、歌曲）"""
    data = request.get_json()
    playlist = PLAYLISTS_MANAGER.get_playlist(playlist_id)
    if not playlist:
        return jsonify({"error": "歌单不存在"}), 404

    try:
        if "name" in data:
            PLAYLISTS_MANAGER.rename_playlist(playlist_id, data["name"].strip())
        if "songs" in data:
            PLAYLISTS_MANAGER.reorder_playlist_songs(playlist_id, data["songs"])
        
        updated_playlist = PLAYLISTS_MANAGER.get_playlist(playlist_id)
        return jsonify(updated_playlist.to_dict())
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@APP.route("/playlists/<playlist_id>", methods=["DELETE"])
def api_delete_playlist(playlist_id):
    """删除歌单（默认歌单不可删除）"""
    if playlist_id == DEFAULT_PLAYLIST_ID:
        return jsonify({"error": "默认歌单不可删除"}), 400

    if PLAYLISTS_MANAGER.delete_playlist(playlist_id):
        return jsonify({"success": True})
    return jsonify({"error": "歌单不存在"}), 404


@APP.route("/playlists/<playlist_id>/switch", methods=["POST"])
def api_switch_playlist(playlist_id):
    """切换到指定歌单"""
    global CURRENT_PLAYLIST_ID, PLAYLIST, PLAY_QUEUE
    
    playlist = PLAYLISTS_MANAGER.get_playlist(playlist_id)
    if not playlist:
        return jsonify({"error": "歌单不存在"}), 404

    try:
        # 保存当前播放队列到当前歌单
        current_pl = PLAYLISTS_MANAGER.get_playlist(CURRENT_PLAYLIST_ID)
        if current_pl:
            # 序列化所有song对象为dict，保留所有字段
            songs_to_save = []
            for song in PLAY_QUEUE.get_all():
                if hasattr(song, 'to_dict'):
                    song_dict = song.to_dict()
                    songs_to_save.append(song_dict)
                    print(f"[DEBUG] 保存歌曲到歌单: {song_dict.get('title')} - 字段: {list(song_dict.keys())}")
                else:
                    print(f"[WARN] 歌曲对象无 to_dict 方法: {song}")
                    songs_to_save.append(str(song))
            
            print(f"[DEBUG] 歌单 {CURRENT_PLAYLIST_ID} 保存 {len(songs_to_save)} 首歌曲")
            current_pl.songs = songs_to_save
            PLAYLISTS_MANAGER.save()

        # 切换到新歌单
        CURRENT_PLAYLIST_ID = playlist_id
        PLAYLIST = playlist.songs
        
        # 更新播放队列（但不改变当前播放）
        PLAY_QUEUE.clear()
        print(f"[DEBUG] 加载歌单 {playlist_id} 的 {len(playlist.songs)} 首歌曲")
        for song_data in playlist.songs:
            if isinstance(song_data, dict):
                # 从dict重新构造song对象
                song = Song.from_dict(song_data)
                print(f"[DEBUG] 加载歌曲: {song.title} (类型: {song.type}, 字段数: {len(song_data)})")
                PLAY_QUEUE.add(song)
            else:
                # 兼容旧的字符串路径格式
                song = LocalSong(file_path=song_data)
                print(f"[DEBUG] 加载本地歌曲: {song_data}")
                PLAY_QUEUE.add(song)
        PLAYER.save_play_queue()

        return jsonify({
            "status": "ok",
            "current_playlist_id": CURRENT_PLAYLIST_ID,
            "playlist": playlist.to_dict()
        })
    except Exception as e:
        print(f"[ERROR] 切换歌单失败: {e}")
        return jsonify({"error": str(e)}), 500


@APP.route("/playlists/<playlist_id>/add_song", methods=["POST"])
def api_add_song_to_playlist(playlist_id):
    """添加歌曲到歌单 - 支持路径字符串或完整song对象"""
    data = request.get_json()
    song_path = data.get("path", "")
    song_data = data.get("song")  # 也支持传递完整song dict
    
    if song_data and isinstance(song_data, dict):
        # 如果提供了完整song dict，则使用它
        print(f"[DEBUG] 添加歌曲到歌单 {playlist_id}: {song_data.get('title')} - 字段: {list(song_data.keys())}")
        if PLAYLISTS_MANAGER.add_song_to_playlist(playlist_id, song_data):
            playlist = PLAYLISTS_MANAGER.get_playlist(playlist_id)
            print(f"[DEBUG] 歌曲添加成功，歌单现有 {len(playlist.songs)} 首歌曲")
            return jsonify(playlist.to_dict())
    elif song_path:
        # 传统的路径字符串方式
        print(f"[DEBUG] 添加歌曲到歌单 {playlist_id}: {song_path}")
        if PLAYLISTS_MANAGER.add_song_to_playlist(playlist_id, song_path):
            playlist = PLAYLISTS_MANAGER.get_playlist(playlist_id)
            return jsonify(playlist.to_dict())
    else:
        return jsonify({"error": "歌曲路径或song对象不能为空"}), 400
    
    return jsonify({"error": "歌单不存在或歌曲已存在"}), 404


@APP.route("/playlists/<playlist_id>/remove_song", methods=["POST"])
def api_remove_song_from_playlist(playlist_id):
    """从歌单移除歌曲"""
    data = request.get_json()
    song_path = data.get("path", "")

    if PLAYLISTS_MANAGER.remove_song_from_playlist(playlist_id, song_path):
        playlist = PLAYLISTS_MANAGER.get_playlist(playlist_id)
        return jsonify(playlist.to_dict())
    return jsonify({"error": "歌单不存在或歌曲不存在"}), 404


@APP.route("/playlists/<playlist_id>/remove_song_by_index", methods=["POST"])
def api_remove_song_by_index(playlist_id):
    """按索引从歌单移除歌曲"""
    data = request.get_json()
    index = data.get("index", -1)

    if index < 0:
        return jsonify({"error": "索引无效"}), 400

    song_path = PLAYLISTS_MANAGER.remove_song_at_index(playlist_id, index)
    if song_path:
        playlist = PLAYLISTS_MANAGER.get_playlist(playlist_id)
        return jsonify(playlist.to_dict())
    return jsonify({"error": "歌单不存在或索引越界"}), 404


@APP.route("/playlists/<playlist_id>/reorder_songs", methods=["POST"])
def api_reorder_playlist_songs(playlist_id):
    """重新排序歌单中的歌曲"""
    data = request.get_json()
    new_order = data.get("songs", [])

    if PLAYLISTS_MANAGER.reorder_playlist_songs(playlist_id, new_order):
        playlist = PLAYLISTS_MANAGER.get_playlist(playlist_id)
        return jsonify(playlist.to_dict())
    return jsonify({"error": "歌单不存在或新列表无效"}), 404


@APP.route("/playlists/clear/<playlist_id>", methods=["POST"])
def api_clear_playlist(playlist_id):
    """清空歌单"""
    if PLAYLISTS_MANAGER.clear_playlist(playlist_id):
        return jsonify({"success": True})
    return jsonify({"error": "歌单不存在"}), 404


if __name__ == "__main__":
    APP.run(host=PLAYER.flask_host, port=PLAYER.flask_port, debug=PLAYER.debug)
