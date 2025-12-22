"""
播放列表基类和子类实现
"""

import json
import os
import logging
from abc import ABC, abstractmethod
from .song import Song, LocalSong, StreamSong

logger = logging.getLogger(__name__)


class BasePlaylist(ABC):
    """播放列表基类 - 抽象基类"""

    def __init__(self, max_size: int = None):
        """初始化播放列表

        参数:
          max_size: 列表最大大小（None表示无限制）
        """
        self._items = []  # 存储项目的列表
        self._current_index = -1
        self._max_size = max_size

    def add(self, item):
        """添加项目到列表最上位置"""
        self._items.insert(0, item)
        if self._max_size and len(self._items) > self._max_size:
            self._items = self._items[:self._max_size]

    def insert(self, index: int, item):
        """在指定位置插入项目"""
        self._items.insert(index, item)
        if self._max_size and len(self._items) > self._max_size:
            self._items = self._items[-self._max_size :]

    def remove(self, index: int):
        """删除指定位置的项目"""
        if 0 <= index < len(self._items):
            self._items.pop(index)
            # 调整当前索引
            if self._current_index >= index and self._current_index > 0:
                self._current_index -= 1

    def clear(self):
        """清空列表"""
        self._items = []
        self._current_index = -1

    def get_current(self):
        """获取当前项目"""
        if 0 <= self._current_index < len(self._items):
            return self._items[self._current_index]
        return None

    def set_current_index(self, index: int):
        """设置当前索引"""
        if -1 <= index < len(self._items):
            self._current_index = index

    def get_current_index(self) -> int:
        """获取当前索引"""
        return self._current_index

    def get_item(self, index: int):
        """获取指定位置的项目"""
        if 0 <= index < len(self._items):
            return self._items[index]
        return None

    def get_all(self) -> list:
        """获取所有项目"""
        return self._items.copy()

    def size(self) -> int:
        """获取列表大小"""
        return len(self._items)

    def is_empty(self) -> bool:
        """列表是否为空"""
        return len(self._items) == 0

    def next(self):
        """移动到下一个项目"""
        if self._current_index < len(self._items) - 1:
            self._current_index += 1
            return self.get_current()
        return None

    def previous(self):
        """移动到上一个项目"""
        if self._current_index > 0:
            self._current_index -= 1
            return self.get_current()
        return None

    def has_next(self) -> bool:
        """是否有下一个项目"""
        return self._current_index < len(self._items) - 1

    def has_previous(self) -> bool:
        """是否有上一个项目"""
        return self._current_index > 0

    @abstractmethod
    def to_dict(self) -> dict:
        """转换为字典"""
        pass

    @abstractmethod
    def from_dict(self, data: dict):
        """从字典加载"""
        pass

    def __repr__(self):
        return f"{self.__class__.__name__}(size={len(self._items)}, current_index={self._current_index})"




# 当前播放列表类
class Playlist(BasePlaylist):
    def __init__(self, max_size: int = None):
        super().__init__(max_size=max_size)

    def to_dict(self) -> dict:
        return {
            "items": [item.to_dict() if hasattr(item, 'to_dict') else item for item in self._items],
            "current_index": self._current_index,
            "max_size": self._max_size,
        }

    def from_dict(self, data: dict):
        if isinstance(data, dict):
            items = data.get("items", [])
            self._items = [Song.from_dict(item) if isinstance(item, dict) else item for item in items]
            self._current_index = data.get("current_index", -1)
            self._max_size = data.get("max_size", None)
            if self._current_index >= len(self._items):
                self._current_index = -1




# LocalPlaylist 已迁移到 models/local_playlist.py


# 当前播放列表队列类，兼容旧 PlayQueue 功能
class CurrentPlaylist(BasePlaylist):
    """当前播放列表 - 兼容 PlayQueue 的所有功能"""
    def __init__(self):
        super().__init__(max_size=None)

    def reorder(self, from_index: int, to_index: int):
        if 0 <= from_index < len(self._items) and 0 <= to_index < len(self._items):
            song = self._items.pop(from_index)
            self._items.insert(to_index, song)
            if self._current_index == from_index:
                self._current_index = to_index
            elif from_index < self._current_index <= to_index:
                self._current_index -= 1
            elif to_index <= self._current_index < from_index:
                self._current_index += 1

    def sort_playlist(self, sort_by: str = "add_order", reverse: bool = False):
        if self.is_empty():
            return
        try:
            if sort_by == "add_order":
                if reverse:
                    self._items.reverse()
            elif sort_by == "current_first":
                if 0 <= self._current_index < len(self._items):
                    current_song = self._items.pop(self._current_index)
                    self._items.insert(0, current_song)
                    self._current_index = 0
                    if reverse:
                        self._items.reverse()
            elif sort_by == "type":
                local_songs = [song for song in self._items if isinstance(song, LocalSong)]
                stream_songs = [song for song in self._items if isinstance(song, StreamSong)]
                if reverse:
                    self._items = stream_songs + local_songs
                else:
                    self._items = local_songs + stream_songs
                if 0 <= self._current_index < len(self._items):
                    current_song = self._items[self._current_index]
                    for idx, song in enumerate(self._items):
                        if song is current_song:
                            self._current_index = idx
                            break
            logger.info(f"播放列表已重排序（sort_by={sort_by}, reverse={reverse}）")
        except Exception as e:
            logger.error(f"播放列表排序失败: {e}")
            import traceback
            traceback.print_exc()

    def play(self,
        index: int = None,
        save_to_history: bool = True,
        mpv_command_func=None,
        mpv_pipe_exists_func=None,
        ensure_mpv_func=None,
        add_to_history_func=None,
        music_dir: str = None,
    ) -> bool:
        if index is not None:
            if 0 <= index < len(self._items):
                self._current_index = index
            else:
                logger.error(f"CurrentPlaylist.play: 索引 {index} 超出范围")
                return False
        song = self.get_current()
        if song is None:
            logger.error(f"CurrentPlaylist.play: 没有当前歌曲")
            return False
        logger.debug(f"CurrentPlaylist.play -> 索引={self._current_index}, 歌曲类型={type(song).__name__}")
        if isinstance(song, LocalSong):
            logger.debug(f"调用本地歌曲播放方法")
            return song.play(
                mpv_command_func=mpv_command_func,
                mpv_pipe_exists_func=mpv_pipe_exists_func,
                ensure_mpv_func=ensure_mpv_func,
                add_to_history_func=add_to_history_func,
                save_to_history=save_to_history,
                music_dir=music_dir,
            )
        elif isinstance(song, StreamSong):
            logger.debug(f"调用串流歌曲播放方法")
            return song.play(
                mpv_command_func=mpv_command_func,
                mpv_pipe_exists_func=mpv_pipe_exists_func,
                ensure_mpv_func=ensure_mpv_func,
                add_to_history_func=add_to_history_func,
                save_to_history=save_to_history,
                music_dir=music_dir,
            )
        else:
            logger.error(f"CurrentPlaylist.play: 未知的歌曲类型 {type(song)}")
            return False

    def play_at_index(self,
        index: int,
        save_to_history: bool = True,
        mpv_command_func=None,
        mpv_pipe_exists_func=None,
        ensure_mpv_func=None,
        add_to_history_func=None,
        music_dir: str = None,
    ) -> bool:
        if index < 0 or index >= len(self._items):
            logger.error(f"CurrentPlaylist.play_at_index: 索引 {index} 超出范围")
            return False
        return self.play(
            index=index,
            save_to_history=save_to_history,
            mpv_command_func=mpv_command_func,
            mpv_pipe_exists_func=mpv_pipe_exists_func,
            ensure_mpv_func=ensure_mpv_func,
            add_to_history_func=add_to_history_func,
            music_dir=music_dir,
        )

    def play_next(self,
        save_to_history: bool = True,
        mpv_command_func=None,
        mpv_pipe_exists_func=None,
        ensure_mpv_func=None,
        add_to_history_func=None,
        music_dir: str = None,
    ) -> bool:
        if not self.has_next():
            logger.info("已到达播放列表末尾")
            return False
        next_song = self.next()
        if next_song is None:
            return False
        logger.info(f"已自动播放列表中的下一首: {next_song.title}")
        return self.play(
            save_to_history=save_to_history,
            mpv_command_func=mpv_command_func,
            mpv_pipe_exists_func=mpv_pipe_exists_func,
            ensure_mpv_func=ensure_mpv_func,
            add_to_history_func=add_to_history_func,
            music_dir=music_dir,
        )

    def to_dict(self) -> dict:
        return {
            "items": [item.to_dict() if hasattr(item, 'to_dict') else item for item in self._items],
            "current_index": self._current_index,
        }

    def from_dict(self, data: dict):
        if isinstance(data, dict):
            items = data.get("items", [])
            self._items = [Song.from_dict(item) if isinstance(item, dict) else item for item in items]
            self._current_index = data.get("current_index", -1)
            if self._current_index >= len(self._items):
                self._current_index = -1

    def clear_playlist(self):
        self._items = []
        self._current_index = -1


class PlayHistory(Playlist):
    """播放历史 - 继承自Playlist，每个Song对象有play_count属性"""

    def __init__(self, max_size: int = 50, file_path: str = None):
        """初始化播放历史

        参数:
          max_size: 历史记录最大条数（默认 50）
          file_path: 持久化存储文件路径
        """
        super().__init__(max_size=max_size)
        self._file_path = file_path

    def add_to_history(self, url_or_path: str, name: str, is_local: bool = False, thumbnail_url: str = None):
        """添加项目到历史记录，聚合相同URL的播放并记录每次播放时间

        参数:
          url_or_path: URL 或本地文件路径
          name: 项目名称
          is_local: 是否为本地文件
          thumbnail_url: 缩略图URL（可选）
        """
        import time

        # 查找已存在的同一URL记录
        existing_song = None
        existing_index = -1
        for idx, song in enumerate(self._items):
            if isinstance(song, Song) and song.url == url_or_path:
                existing_song = song
                existing_index = idx
                break

        current_timestamp = int(time.time())

        if existing_song:
            # 如果已存在，增加play_count并更新时间戳
            if not hasattr(existing_song, 'play_count'):
                existing_song.play_count = 0
            existing_song.play_count += 1
            existing_song.timestamp = current_timestamp
            existing_song.ts = current_timestamp
            existing_song.title = name  # 更新名称
            if thumbnail_url and hasattr(existing_song, 'thumbnail_url'):
                existing_song.thumbnail_url = thumbnail_url
            
            # 维护 timestamps 字段（逗号分割的时间戳列表）
            if not hasattr(existing_song, 'timestamps'):
                existing_song.timestamps = str(current_timestamp)
            else:
                # 添加新的时间戳
                existing_song.timestamps = f"{existing_song.timestamps},{current_timestamp}"
            
            # 将该项移动到列表头部
            self._items.pop(existing_index)
            self._items.insert(0, existing_song)
            logger.debug(f"已更新播放历史: {name} ({existing_song.type})，播放次数: {existing_song.play_count}，时间戳: {current_timestamp}")
        else:
            # 如果不存在，创建新Song对象
            if is_local:
                song = LocalSong(url_or_path, title=name)
            else:
                song = StreamSong(url_or_path, title=name)
                if thumbnail_url:
                    song.thumbnail_url = thumbnail_url
            
            # 添加播放历史特有属性
            song.play_count = 1
            song.timestamp = current_timestamp
            song.ts = current_timestamp
            song.timestamps = str(current_timestamp)  # 第一次播放的时间戳
            
            self._items.insert(0, song)
            # 保持列表大小限制
            if self._max_size and len(self._items) > self._max_size:
                self._items = self._items[: self._max_size]
            logger.debug(f"已添加播放历史: {name} ({song.type})，时间戳: {current_timestamp}")

        # 保存到文件
        if self._file_path:
            self.save()

    def set_file_path(self, file_path: str):
        """设置持久化文件路径"""
        self._file_path = file_path

    def save(self):
        """保存历史记录到文件（包含aggregated play_count和timestamps）"""
        if not self._file_path:
            return
        try:
            # 转换为字典格式保存
            data = []
            for song in self._items:
                song_dict = song.to_dict() if hasattr(song, 'to_dict') else {}
                # 保存播放历史特有属性
                song_dict['play_count'] = getattr(song, 'play_count', 1)
                song_dict['ts'] = getattr(song, 'timestamp', 0)
                # 保存每次播放的时间戳列表
                song_dict['timestamps'] = getattr(song, 'timestamps', str(getattr(song, 'timestamp', 0)))
                data.append(song_dict)
            
            with open(self._file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"保存播放历史失败: {e}")

    def load(self):
        """从文件加载历史记录"""
        if not self._file_path or not os.path.exists(self._file_path):
            self._items = []
            return

        try:
            with open(self._file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    self._items = []
                    for item in data[: self._max_size]:
                        # 从字典创建Song对象
                        song = Song.from_dict(item) if isinstance(item, dict) else None
                        if song:
                            # 恢复播放历史特有属性
                            song.play_count = item.get('play_count', 1)
                            song.timestamp = item.get('ts', 0)
                            song.ts = song.timestamp
                            # 恢复每次播放的时间戳列表
                            song.timestamps = item.get('timestamps', str(song.timestamp))
                            self._items.append(song)
                    logger.info(f"已加载 {len(self._items)} 条播放历史")
                else:
                    self._items = []
        except Exception as e:
            logger.error(f"加载播放历史失败: {e}")
            self._items = []

    def update_item(self, index: int, **kwargs):
        """更新历史记录中的项目属性

        参数:
          index: 项目索引
          **kwargs: 要更新的属性（如 name, title 等）
        """
        if 0 <= index < len(self._items):
            song = self._items[index]
            for key, value in kwargs.items():
                setattr(song, key, value)
            if self._file_path:
                self.save()

    def get_all(self) -> list:
        """获取所有历史记录，返回字典格式以兼容现有API"""
        result = []
        for song in self._items:
            item = song.to_dict() if hasattr(song, 'to_dict') else {}
            item['play_count'] = getattr(song, 'play_count', 1)
            item['ts'] = getattr(song, 'timestamp', 0)
            # 包含每次播放的时间戳列表
            item['timestamps'] = getattr(song, 'timestamps', str(getattr(song, 'timestamp', 0)))
            result.append(item)
        return result
    
    def get_play_timestamps(self, url: str) -> list:
        """获取特定URL的所有播放时间戳列表
        
        参数:
          url: 歌曲URL
        
        返回:
          时间戳列表 (整数列表)
        """
        for song in self._items:
            if isinstance(song, Song) and song.url == url:
                timestamps_str = getattr(song, 'timestamps', '')
                if timestamps_str:
                    try:
                        return [int(ts) for ts in timestamps_str.split(',')]
                    except:
                        return []
        return []

    def clear(self):
        """清空所有播放历史"""
        self._items = []
        self._current_index = -1
        if self._file_path:
            self.save()
        logger.info("播放历史已清空")

