"""
排行榜模块 - 提供不同类型的排行榜功能
"""

import time
from abc import ABC, abstractmethod
from typing import List, Dict, Any


class Rank(ABC):
    """排行榜基类 - 抽象基类"""

    def __init__(self, max_size: int = 100):
        """初始化排行榜

        参数:
          max_size: 排行榜最大显示条数（默认 100）
        """
        self._max_size = max_size

    @abstractmethod
    def calculate(self, items: List[Dict[str, Any]], period: str = 'all') -> List[Dict[str, Any]]:
        """计算排行榜数据

        参数:
          items: 原始数据项列表
          period: 时间周期 ('all', 'week', 'month')

        返回:
          排序后的排行榜列表
        """
        pass

    @abstractmethod
    def get_rankings(self, items: List[Dict[str, Any]], period: str = 'all', limit: int = 10) -> List[Dict[str, Any]]:
        """获取排行榜

        参数:
          items: 原始数据项列表
          period: 时间周期
          limit: 返回的最大条数

        返回:
          排行榜列表（带排名）
        """
        pass

    def _filter_by_period(self, items: List[Dict[str, Any]], period: str) -> List[Dict[str, Any]]:
        """根据时间周期过滤项目

        参数:
          items: 数据项列表
          period: 时间周期 ('all', 'today', 'week', 'month')

        返回:
          过滤后的列表
        """
        if period == 'all':
            return items

        now = time.time()
        if period == 'today':
            # 获取今天 00:00:00 的时间戳
            import datetime
            today_start = datetime.datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
            cutoff_time = today_start.timestamp()
        elif period == 'week':
            cutoff_time = now - (7 * 24 * 60 * 60)
        elif period == 'month':
            cutoff_time = now - (30 * 24 * 60 * 60)
        else:
            return items

        return [item for item in items if item.get('ts', 0) >= cutoff_time]

    def __repr__(self):
        return f"{self.__class__.__name__}(max_size={self._max_size})"


class HitRank(Rank):
    """播放点击排行 - 统计歌曲播放次数排行

    根据歌曲的播放次数进行排序，支持按时间周期过滤。
    """

    def __init__(self, max_size: int = 100):
        """初始化播放排行

        参数:
          max_size: 排行榜最大显示条数（默认 100）
        """
        super().__init__(max_size=max_size)

    def calculate(self, items: List[Dict[str, Any]], period: str = 'all') -> List[Dict[str, Any]]:
        """计算播放排行

        参数:
          items: 播放历史项列表，每项应包含 'url', 'title', 'play_count', 'ts' 等字段
          period: 时间周期 ('all', 'week', 'month')

        返回:
          按播放次数排序的列表
        """
        if not items:
            return []

        # 按时间周期过滤
        filtered_items = self._filter_by_period(items, period)

        # 统计相同URL的播放次数
        rankings_dict = {}
        for item in filtered_items:
            url = item.get('url')
            if not url:
                continue

            if url not in rankings_dict:
                rankings_dict[url] = {
                    'url': url,
                    'title': item.get('title') or item.get('name') or '未知歌曲',
                    'type': item.get('type', 'local'),
                    'thumbnail_url': item.get('thumbnail_url'),
                    'ts': item.get('ts', 0),
                    'play_count': 0,
                }

            # 累加播放次数
            rankings_dict[url]['play_count'] += item.get('play_count', 1)

        # 转换为列表并按播放次数排序
        rankings = list(rankings_dict.values())
        rankings.sort(key=lambda x: x['play_count'], reverse=True)

        return rankings

    def get_rankings(self, items: List[Dict[str, Any]], period: str = 'all', limit: int = 10) -> List[Dict[str, Any]]:
        """获取播放排行

        参数:
          items: 播放历史项列表
          period: 时间周期
          limit: 返回的最大条数

        返回:
          排行榜列表，每项带有 'rank' 字段
        """
        # 计算排行
        rankings = self.calculate(items, period)

        # 限制条数
        rankings = rankings[:min(limit, self._max_size)]

        # 添加排名
        for idx, item in enumerate(rankings, 1):
            item['rank'] = idx

        return rankings

    def get_top_n(self, items: List[Dict[str, Any]], n: int = 3, period: str = 'all') -> List[Dict[str, Any]]:
        """获取前N名

        参数:
          items: 播放历史项列表
          n: 前N名
          period: 时间周期

        返回:
          前N名排行榜
        """
        return self.get_rankings(items, period, n)

    def is_in_top_n(self, items: List[Dict[str, Any]], url: str, n: int = 3, period: str = 'all') -> bool:
        """检查某个URL是否在前N名中

        参数:
          items: 播放历史项列表
          url: 要检查的URL
          n: 前N名
          period: 时间周期

        返回:
          True 如果在前N名中，否则 False
        """
        top_n = self.get_top_n(items, n, period)
        return any(item['url'] == url for item in top_n)
