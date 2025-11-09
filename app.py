import os, sys, json, threading, time, subprocess, configparser, platform
from flask import Flask, render_template, jsonify, request, abort, send_file
from werkzeug.utils import secure_filename
from PIL import Image, ImageDraw, ImageFont
from io import BytesIO

APP = Flask(__name__, template_folder='.')

#############################################
# 配置: settings.ini (仅使用 INI, 已彻底移除 settings.json 支持)
#############################################
_LOCK = threading.RLock()

DEFAULT_CFG = {
	'MUSIC_DIR': 'Z:',
	'ALLOWED_EXTENSIONS': '.mp3,.wav,.flac',  # INI 中用逗号/分号分隔
	'FLASK_HOST': '0.0.0.0',
	'FLASK_PORT': '9000',
	'DEBUG': 'true',
	'MPV_CMD': None  # 将在运行时设置
}

def _get_app_dir():
    """获取应用程序目录，支持打包和开发环境"""
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))

# 设置默认的 MPV 命令
def _get_default_mpv_cmd():
    app_dir = _get_app_dir()
    mpv_path = os.path.join(app_dir, 'mpv.exe')
    if os.path.exists(mpv_path):
        return f'"{mpv_path}" --input-ipc-server=\\\\.\\\pipe\\\\mpv-pipe --idle=yes --force-window=no'
    return r'c:\mpv\mpv.exe --input-ipc-server=\\.\pipe\mpv-pipe --idle=yes --force-window=no'

DEFAULT_CFG['MPV_CMD'] = _get_default_mpv_cmd()

def _ini_path():
    return os.path.join(_get_app_dir(), 'settings.ini')

def _ensure_ini_exists():
	ini_path = _ini_path()
	if os.path.exists(ini_path):
		return
	cp = configparser.ConfigParser()
	cp['app'] = DEFAULT_CFG.copy()
	with open(ini_path,'w',encoding='utf-8') as w:
		cp.write(w)
	print('[INFO] 已生成默认 settings.ini')

def _read_ini_locked():
	ini_path = _ini_path()
	cp = configparser.ConfigParser()
	read_ok = cp.read(ini_path, encoding='utf-8')
	if not read_ok:
		return DEFAULT_CFG.copy()
	if 'app' not in cp:
		return DEFAULT_CFG.copy()
	raw = DEFAULT_CFG.copy()
	for k,v in cp['app'].items():
		raw[k.upper()] = v
	return raw

def load_settings():
	with _LOCK:
		return json.loads(json.dumps(_read_ini_locked()))  # 深拷贝

def update_settings(patch: dict):
	with _LOCK:
		cfg = _read_ini_locked()
		for k,v in patch.items():
			cfg[k.upper()] = v
		# 写回
		cp = configparser.ConfigParser()
		cp['app'] = {}
		for k,v in cfg.items():
			if k == 'ALLOWED_EXTENSIONS':
				if isinstance(v, (list,tuple,set)):
					cp['app'][k] = ','.join(sorted(v))
				else:
					cp['app'][k] = str(v)
			else:
				cp['app'][k] = str(v)
		ini_path = _ini_path()
		tmp = ini_path + '.tmp'
		with open(tmp,'w',encoding='utf-8') as w:
			cp.write(w)
		os.replace(tmp, ini_path)
		return cfg

_ensure_ini_exists()
cfg = load_settings()
#############################################

# 下面使用 cfg 不变
MUSIC_DIR = cfg.get('MUSIC_DIR', 'Z:')
if len(MUSIC_DIR) == 2 and MUSIC_DIR[1] == ':' and MUSIC_DIR[0].isalpha():
    MUSIC_DIR += '\\'
MUSIC_DIR = os.path.abspath(MUSIC_DIR)
_ext_raw = cfg.get('ALLOWED_EXTENSIONS', '.mp3,.wav,.flac')
if isinstance(_ext_raw, str):
	parts = [e.strip() for e in _ext_raw.replace(';',',').split(',') if e.strip()]
else:
	parts = list(_ext_raw)
ALLOWED = set([e if e.startswith('.') else '.'+e for e in parts])
MPV_CMD = cfg.get('MPV_CMD') or cfg.get('MPV') or ''

def _extract_pipe_name(cmd: str, fallback: str = r'\\.\\pipe\\mpv-pipe') -> str:
	"""从 MPV_CMD 中解析 --input-ipc-server 值; 支持两种形式:
	1) --input-ipc-server=\\.\\pipe\\mpv-pipe
	2) --input-ipc-server \\.\\pipe\\mpv-pipe
	若解析失败返回 fallback.
	"""
	if not cmd:
		return fallback
	parts = cmd.split()
	for i,p in enumerate(parts):
		if p.startswith('--input-ipc-server='):
			val = p.split('=',1)[1].strip().strip('"')
			return val or fallback
		if p == '--input-ipc-server' and i+1 < len(parts):
			val = parts[i+1].strip().strip('"')
			if val and not val.startswith('--'):
				return val
	return fallback

# 兼容: 若 settings 仍含 PIPE_NAME 则优先; 否则从 MPV_CMD 解析
PIPE_NAME = cfg.get('PIPE_NAME') or _extract_pipe_name(MPV_CMD)

def mpv_pipe_exists(path: str = None) -> bool:
	p = path or PIPE_NAME
	try:
		with open(p, 'wb'):
			return True
	except Exception:
		return False

# 播放列表 & 自动播放
PLAYLIST = []            # 存储相对路径（相对 MUSIC_DIR）
CURRENT_INDEX = -1
_AUTO_THREAD = None
_STOP_FLAG = False
_REQ_ID = 0
CURRENT_META = {}  # 仅内存保存当前播放信息，不写入 settings.json
SHUFFLE = False

# =========== 文件树 / 安全路径 ===========
def safe_path(rel: str):
	base = os.path.abspath(MUSIC_DIR)
	target = os.path.abspath(os.path.join(base, rel))
	if not target.startswith(base):
		raise ValueError('非法路径')
	if not os.path.exists(target):
		raise ValueError('不存在的文件')
	return target

def gather_tracks(root):
	tracks = []
	for dp, _, files in os.walk(root):
		for f in files:
			ext = os.path.splitext(f)[1].lower()
			if ext in ALLOWED:
				tracks.append(os.path.abspath(os.path.join(dp, f)))
	return tracks

def build_tree():
	abs_root = os.path.abspath(MUSIC_DIR)
	def walk(path):
		rel = os.path.relpath(path, abs_root).replace('\\', '/')
		node = { 'name': os.path.basename(path) or '根目录', 'rel': '' if rel == '.' else rel, 'dirs': [], 'files': [] }
		try:
			for name in sorted(os.listdir(path), key=str.lower):
				full = os.path.join(path, name)
				if os.path.isdir(full):
					node['dirs'].append(walk(full))
				else:
					ext = os.path.splitext(name)[1].lower()
					if ext in ALLOWED:
						rp = os.path.relpath(full, abs_root).replace('\\','/')
						node['files'].append({'name': name, 'rel': rp})
		except Exception:
			pass
		return node
	return walk(abs_root)

# =========== MPV 启动 & IPC ===========
def _wait_pipe(timeout=6.0):
	end = time.time() + timeout
	while time.time() < end:
		try:
			with open(PIPE_NAME, 'wb') as _: return True
		except Exception: time.sleep(0.15)
	return False

def ensure_mpv():
	global PIPE_NAME
	# 每次调用重新解析，允许运行期间修改 MPV_CMD 并热加载（若外部修改变量并重载模块则生效）
	PIPE_NAME = _extract_pipe_name(MPV_CMD) if not cfg.get('PIPE_NAME') else cfg.get('PIPE_NAME')
	if not MPV_CMD:
		print('[WARN] 未配置 MPV_CMD')
		return False
	if mpv_pipe_exists():
		return True
	print(f'[INFO] 尝试启动 mpv: {MPV_CMD}')
	try:
		subprocess.Popen(MPV_CMD, shell=True)
	except Exception as e:
		print('[ERROR] 启动 mpv 进程失败:', e)
		return False
	ready = _wait_pipe()
	if not ready:
		print('[ERROR] 等待 mpv 管道超时: ', PIPE_NAME)
	return ready

def mpv_command(cmd_list):
	# 写命令，失败时自动尝试启动一次再重试
	def _write():
		with open(PIPE_NAME, 'wb') as w:
			w.write((json.dumps({'command': cmd_list})+'\n').encode('utf-8'))
	try:
		_write()
	except Exception as e:
		print(f'[WARN] 首次写入失败: {e}. 尝试 ensure_mpv 后重试...')
		if ensure_mpv():
			try:
				_write()
				return
			except Exception as e2:
				raise RuntimeError(f'MPV 管道写入失败(重试): {e2}')
		raise RuntimeError(f'MPV 管道写入失败: {e}')

def mpv_request(payload: dict):
	# 简单同步请求/响应
	with open(PIPE_NAME, 'r+b', 0) as f:
		f.write((json.dumps(payload)+'\n').encode('utf-8'))
		f.flush()
		while True:
			line = f.readline()
			if not line:
				break
			try:
				obj = json.loads(line.decode('utf-8','ignore'))
			except Exception:
				continue
			if obj.get('request_id') == payload.get('request_id'):
				return obj
	return None

def mpv_get(prop: str):
	global _REQ_ID
	_REQ_ID += 1
	req = {"command":["get_property", prop], "request_id": _REQ_ID}
	resp = mpv_request(req)
	if not resp:
		return None
	return resp.get('data')

def mpv_set(prop: str, value):
	try:
		mpv_command(['set_property', prop, value])
		return True
	except Exception:
		return False

def _build_playlist():
	abs_root = os.path.abspath(MUSIC_DIR)
	tracks = []
	for dp, _, files in os.walk(abs_root):
		for f in files:
			ext = os.path.splitext(f)[1].lower()
			if ext in ALLOWED:
				rel = os.path.relpath(os.path.join(dp,f), abs_root).replace('\\','/')
				tracks.append(rel)
	tracks.sort(key=str.lower)
	return tracks

def _ensure_playlist(force: bool = False):
	"""确保内存 PLAYLIST 存在; force=True 时强制重建."""
	global PLAYLIST
	if force or not PLAYLIST:
		PLAYLIST = _build_playlist()
	return PLAYLIST

def _play_index(idx: int):
	global CURRENT_INDEX, CURRENT_META
	if idx < 0 or idx >= len(PLAYLIST):
		return False
	rel = PLAYLIST[idx]
	abs_file = safe_path(rel)
	mpv_command(['loadfile', abs_file, 'replace'])
	CURRENT_INDEX = idx
	CURRENT_META = {'abs_path': abs_file, 'rel': rel, 'index': idx, 'ts': int(time.time())}
	return True

def _next_track():
	import random
	if CURRENT_INDEX < 0:
		return False
	if SHUFFLE and len(PLAYLIST) > 1:
		# 随机选择一个不同的索引
		choices = list(range(len(PLAYLIST)))
		try:
			choices.remove(CURRENT_INDEX)
		except ValueError:
			pass
		if not choices:
			return False
		return _play_index(random.choice(choices))
	nxt = CURRENT_INDEX + 1
	if nxt >= len(PLAYLIST):
		return False
	return _play_index(nxt)

def _prev_track():
	import random
	if CURRENT_INDEX < 0:
		return False
	if SHUFFLE and len(PLAYLIST) > 1:
		choices = list(range(len(PLAYLIST)))
		try:
			choices.remove(CURRENT_INDEX)
		except ValueError:
			pass
		if not choices:
			return False
		return _play_index(random.choice(choices))
	prv = CURRENT_INDEX - 1
	if prv < 0:
		return False
	return _play_index(prv)

def _auto_loop():
	print('[INFO] 自动播放线程已启动')
	while not _STOP_FLAG:
		print('[DEBUG] 自动播放检查...')
		if CURRENT_INDEX < 0:
			# 没有正在播放的，尝试自动加载并播第一首
			_ensure_playlist()
			if PLAYLIST:
				_play_index(0)
				time.sleep(1.0)
				continue
		try:
			# 侦测曲目结束: 优先 eof-reached, 其次 time-pos≈duration, 再次 idle-active
			ended = False
			pos = mpv_get('time-pos')
			dur = mpv_get('duration')
			eof = mpv_get('eof-reached')  # 可能为 None
			if eof is True:
				ended = True
			elif isinstance(pos,(int,float)) and isinstance(dur,(int,float)) and dur>0 and (dur - pos) <= 0.3:
				ended = True
			else:
				idle = mpv_get('idle-active')
				if idle is True and (pos is None or (isinstance(pos,(int,float)) and pos==0)):
					ended = True
			if ended:
				print('[INFO] 当前曲目已结束，尝试播放下一首...')
				if not _next_track():
					# 到末尾，等待再尝试
					time.sleep(10)
					continue
		except Exception:
			pass
		time.sleep(10)

def _ensure_auto_thread():
	global _AUTO_THREAD
	if _AUTO_THREAD and _AUTO_THREAD.is_alive():
		print('[INFO] 自动播放线程已存在')
		return
	_AUTO_THREAD = threading.Thread(target=_auto_loop, daemon=True)
	_AUTO_THREAD.start()

# =========== 路由 ===========
@APP.route('/')
def index():
	tree = build_tree()
	#_AUTO_THREAD = True
	_ensure_auto_thread()
	return render_template('index.html', tree=tree, music_dir=MUSIC_DIR)

@APP.route('/play', methods=['POST'])
def play_route():
	from flask import request
	rel = (request.form.get('path') or '').strip()
	if not rel:
		return jsonify({'status':'ERROR','error':'缺少 path'}), 400
	try:
		if not ensure_mpv():
			return jsonify({'status':'ERROR','error':'mpv 启动失败'}), 400
		global PLAYLIST, CURRENT_INDEX
		if not PLAYLIST or rel not in PLAYLIST:
			PLAYLIST = _build_playlist()
		if rel not in PLAYLIST:
			return jsonify({'status':'ERROR','error':'文件不在列表'}), 400
		idx = PLAYLIST.index(rel)
		if not _play_index(idx):
			return jsonify({'status':'ERROR','error':'播放失败'}), 400
		_ensure_auto_thread()
		return jsonify({'status':'OK','rel':rel,'index':idx,'total':len(PLAYLIST)})
	except Exception as e:
		return jsonify({'status':'ERROR','error':str(e)}), 400

@APP.route('/tree')
def tree_json():
	return jsonify({'status':'OK','tree':build_tree()})

@APP.route('/next', methods=['POST'])
def api_next():
	if not ensure_mpv():
		return jsonify({'status':'ERROR','error':'mpv 未就绪'}), 400
	if _next_track():
		return jsonify({'status':'OK','rel': PLAYLIST[CURRENT_INDEX], 'index': CURRENT_INDEX, 'total': len(PLAYLIST)})
	return jsonify({'status':'ERROR','error':'没有下一首'}), 400

@APP.route('/prev', methods=['POST'])
def api_prev():
	if not ensure_mpv():
		return jsonify({'status':'ERROR','error':'mpv 未就绪'}), 400
	if _prev_track():
		return jsonify({'status':'OK','rel': PLAYLIST[CURRENT_INDEX], 'index': CURRENT_INDEX, 'total': len(PLAYLIST)})
	return jsonify({'status':'ERROR','error':'没有上一首'}), 400

@APP.route('/status')
def api_status():
	"""返回当前播放状态（仅内存），所有客户端轮询实现共享可见性。"""
	playing = CURRENT_META if CURRENT_META else {}
	mpv_info = {}
	# 仅在 mpv 管道可用时尝试获取实时播放属性
	try:
		with open(PIPE_NAME, 'wb') as _:
			try:
				pos = mpv_get('time-pos')
				dur = mpv_get('duration')
				paused = mpv_get('pause')
				vol = mpv_get('volume')
				mpv_info = {
					'time': pos,
					'duration': dur,
					'paused': paused,
					'volume': vol
				}
			except Exception:
				pass
	except Exception:
		pass
	return jsonify({'status':'OK','playing': playing, 'mpv': mpv_info})

@APP.route('/shuffle', methods=['POST'])
def api_shuffle():
	"""切换随机播放模式."""
	global SHUFFLE
	SHUFFLE = not SHUFFLE
	return jsonify({'status':'OK','shuffle': SHUFFLE})

@APP.route('/playlist')
def api_playlist():
	"""返回当前播放列表。

	参数:
	  rebuild=1  强制重建扫描
	  offset, limit  分页 (可选)
	"""
	from flask import request
	force = request.args.get('rebuild') == '1'
	plist = _ensure_playlist(force)
	offset = int(request.args.get('offset', '0') or 0)
	limit = request.args.get('limit')
	if limit is not None:
		try:
			limit_i = max(0, int(limit))
		except ValueError:
			limit_i = 0
	else:
		limit_i = 0
	data = plist
	if offset < 0: offset = 0
	if limit_i > 0:
		data = plist[offset: offset+limit_i]
	return jsonify({
		'status': 'OK',
		'total': len(plist),
		'index': CURRENT_INDEX,
		'current': CURRENT_META.get('rel') if CURRENT_META else None,
		'offset': offset,
		'limit': limit_i or None,
		'playlist': data
	})

@APP.route('/debug/mpv')
def api_debug_mpv():
	info = {
		'MPV_CMD': MPV_CMD,
		'PIPE_NAME': PIPE_NAME,
		'pipe_exists': mpv_pipe_exists(),
		'playlist_len': len(PLAYLIST),
		'current_index': CURRENT_INDEX,
		'shuffle': 'SHUFFLE' in globals() and globals().get('SHUFFLE')
	}
	return jsonify({'status':'OK','info': info})

@APP.route('/preview.png')
def preview_image():
    """提供社交媒体预览图片"""
    print("[DEBUG] 访问预览图片路由")
    from flask import send_file, abort
    from io import BytesIO
    from PIL import Image, ImageDraw, ImageFont
    import os, traceback, math

    def get_system_font():
        """获取系统中文字体"""
        try:
            if platform.system().lower() == 'windows':
                # 首先尝试直接加载微软雅黑（最常见的中文字体）
                msyh_path = os.path.join(os.environ.get('SystemRoot', 'C:\\Windows'), 'Fonts', 'msyh.ttc')
                if os.path.exists(msyh_path):
                    try:
                        # 尝试以二进制方式读取字体文件
                        with open(msyh_path, 'rb') as font_file:
                            font_bytes = font_file.read()
                            # 从字节创建BytesIO对象
                            font_io = BytesIO(font_bytes)
                            # 尝试加载字体
                            test_font = ImageFont.truetype(font_io, 24)
                            # 验证字体是否支持中文
                            bbox = test_font.getbbox("测试")
                            if bbox and bbox[2] > 0 and bbox[3] > 0:
                                print("[DEBUG] 成功加载微软雅黑字体")
                                return font_bytes
                    except Exception as e:
                        print(f"[WARN] 微软雅黑加载失败: {e}")

                # 如果微软雅黑加载失败，尝试其他中文字体
                for font_name in ['simhei.ttf', 'simsun.ttc']:
                    try:
                        font_path = os.path.join(os.environ.get('SystemRoot', 'C:\\Windows'), 'Fonts', font_name)
                        if os.path.exists(font_path):
                            with open(font_path, 'rb') as font_file:
                                font_bytes = font_file.read()
                                font_io = BytesIO(font_bytes)
                                test_font = ImageFont.truetype(font_io, 24)
                                bbox = test_font.getbbox("测试")
                                if bbox and bbox[2] > 0 and bbox[3] > 0:
                                    print(f"[DEBUG] 成功加载字体: {font_name}")
                                    return font_bytes
                    except Exception as e:
                        print(f"[WARN] 字体加载失败 {font_name}: {e}")
            
            print("[WARN] 无法加载系统中文字体")
            return None
        except Exception as e:
            print(f"[ERROR] 字体加载过程出错: {e}")
            return None

    try:
        print("[DEBUG] 创建预览图片...")
        # 创建预览图片（1200x630是社交媒体预览的推荐尺寸）
        width, height = 600, 630
        img = Image.new('RGB', (width, height), color=(30, 31, 36))  # 深色背景
        draw = ImageDraw.Draw(img)

        # 绘制网页风格背景
        print("[DEBUG] 绘制背景...")
        
        # 顶部工具栏背景
        toolbar_height = 60
        draw.rectangle([(0, 0), (width, toolbar_height)], 
                      fill=(40, 41, 46))
        
        # 底部播放器栏背景
        player_height = 50
        draw.rectangle([(0, height-player_height), (width, height)], 
                      fill=(40, 41, 46))
        
        # 进度条
        progress_height = 4
        progress_y = height - player_height - progress_height
        draw.rectangle([(0, progress_y), (width, progress_y + progress_height)], 
                      fill=(50, 51, 56))
        # 进度
        draw.rectangle([(0, progress_y), (width * 0.7, progress_y + progress_height)], 
                      fill=(86, 156, 214))
        
        # 获取实际的播放列表
        tree = build_tree()
        file_items = []
        def collect_files(node, depth=0):
            # 收集文件夹
            for dir_node in node['dirs']:
                if depth < 2:  # 限制显示深度
                    file_items.append(f"📂 {dir_node['name']}")
                    collect_files(dir_node, depth + 1)
            # 收集文件
            for file_node in node['files']:
                if len(file_items) < 5:  # 限制显示数量
                    ext = os.path.splitext(file_node['name'])[1].lower()
                    icon = "🎵" if ext in {'.mp3', '.wav', '.flac'} else "📄"
                    file_items.append(f"{icon} {file_node['name']}")

        collect_files(tree)
        
        # 如果列表为空，添加一些提示文本
        if not file_items:
            file_items = ["📂 音乐库暂无内容", "💡 点击上传按钮添加音乐"]
        
        # 确保至少有5个项目（用空白填充）
        while len(file_items) < 5:
            file_items.append("")
        
        y = toolbar_height + 20
        for item in file_items:
            # 绘制半透明的选择框背景
            if "无损音乐" in item:  # 当前播放项
                draw.rectangle([(40, y-5), (width-40, y+35)], 
                             fill=(86, 156, 214, 30))
            draw.rectangle([(40, y-5), (width-40, y+35)], 
                         outline=(60, 61, 66), width=1)
            y += 50

        # 尝试加载字体
        print("[DEBUG] 加载字体...")
        # 获取系统字体字节数据
        font_bytes = get_system_font()
        
        # 定义字体大小
        font_size_title = 64
        font_size_button = 32
        font_size_text = 24
        font_size_desc = 60

        # 创建字体对象
        font_bytes = get_system_font()
        try:
            if font_bytes:
                font_io = BytesIO(font_bytes)
                title_font = ImageFont.truetype(font_io, font_size_title)
                font_io.seek(0)  # 重置BytesIO位置
                button_font = ImageFont.truetype(font_io, font_size_button)
                font_io.seek(0)
                text_font = ImageFont.truetype(font_io, font_size_text)
                font_io.seek(0)
                desc_font = ImageFont.truetype(font_io, font_size_desc)
                print("[DEBUG] 成功加载所有字体大小变体")
            else:
                raise Exception("No font bytes available")
        except Exception as e:
            print(f"[ERROR] 加载字体失败: {e}")
            title_font = button_font = text_font = desc_font = ImageFont.load_default()
            print("[WARN] 使用默认字体")

        # 定义要显示的文本
        title = "支持上传音乐"
        description = ""
	
        # 绘制界面元素
        print("[DEBUG] 绘制界面元素...")
        
        # 顶部工具栏按钮
        buttons = ["上传", "上一曲", "下一曲", "随机", "展开", "折叠"]
        x = 20
        for btn in buttons:
            w = 80 if len(btn) > 1 else 50
            draw.rectangle([(x, 10), (x+w, 50)], 
                         fill=(50, 51, 56),
                         outline=(60, 61, 66))
            if hasattr(draw, 'textbbox'):
                bbox = draw.textbbox((0, 0), btn, font=button_font)
                text_w = bbox[2] - bbox[0]
                text_h = bbox[3] - bbox[1]
            else:
                text_w, text_h = draw.textsize(btn, font=button_font)
            draw.text((x + (w-text_w)//2, 15), btn, 
                     font=button_font, fill=(200, 200, 220))
            x += w + 10

        # 文件列表文字
        y = toolbar_height + 20
        for item in file_items:
            if "无损音乐" in item:  # 当前播放项
                color = (86, 156, 214)
            else:
                color = (200, 200, 220)
            draw.text((60, y), item, font=text_font, fill=color)
            y += 50

           
        # 音量控制
        try:
            current_volume = mpv_get('volume')
            volume_text = f"音量: {int(current_volume)}%" if current_volume is not None else "音量: --"
        except:
            volume_text = "音量: --"
        draw.text((width-120, height-player_height+15), volume_text, 
                 font=text_font, fill=(200, 200, 220))

        # 绘制标题
        print("[DEBUG] 绘制标题...")
        if hasattr(draw, 'textbbox'):
            title_bbox = draw.textbbox((0, 0), title, font=title_font)
            title_width = title_bbox[2] - title_bbox[0]
            title_height = title_bbox[3] - title_bbox[1]
            
            desc_bbox = draw.textbbox((0, 0), description, font=desc_font)
            desc_width = desc_bbox[2] - desc_bbox[0]
            desc_height = desc_bbox[3] - desc_bbox[1]
        else:
            title_width, title_height = draw.textsize(title, font=title_font)
            desc_width, desc_height = draw.textsize(description, font=desc_font)

        # 绘制标题（带发光效果）
        title_x = (width - title_width) // 2
        title_y = (height - title_height - desc_height - 40) // 2

        # 发光效果
        glow_color = (255, 255, 255)
        for offset in [(dx,dy) for dx in range(-3,4) for dy in range(-3,4)]:
            if abs(offset[0]) + abs(offset[1]) <= 4:
                draw.text((title_x + offset[0], title_y + offset[1]), 
                         title, font=title_font, fill=glow_color)

        # 主标题
        draw.text((title_x, title_y), title, 
                 font=title_font, fill=(52, 174, 235))

        # 描述文字
        desc_x = (width - desc_width) // 2
        desc_y = title_y + title_height + 40
        draw.text((desc_x, desc_y), description, 
                 font=desc_font, fill=(52, 174, 235))

        print("[DEBUG] 保存为PNG...")
        img_io = BytesIO()
        img.save(img_io, format='PNG', optimize=True)
        img_io.seek(0)
        
        print("[DEBUG] 准备发送响应...")
        response = send_file(
            img_io,
            mimetype='image/png',
            as_attachment=False,
            download_name='preview.png'
        )
        
        # 添加必要的响应头，以支持社交媒体预览
        response.headers['Cache-Control'] = 'public, max-age=31536000'
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = '*'
        response.headers['Cross-Origin-Resource-Policy'] = 'cross-origin'
        
        print("[DEBUG] 响应准备完成")
        return response

    except Exception as e:
        print(f"[ERROR] 预览图片生成失败: {e}")
        print("[ERROR] 详细错误信息:")
        print(traceback.format_exc())
        abort(500)
        
        return send_file(
            output,
            mimetype='image/png',
            as_attachment=False,
            download_name='preview.png'
        )
    except (binascii.Error, Exception) as e:
        print(f'[ERROR] Preview image generation failed: {str(e)}')
        abort(500)

@APP.route('/volume', methods=['POST'])
def api_volume():
	from flask import request
	# form: value 可选(0-100). 不提供则返回当前音量
	if not ensure_mpv():
		return jsonify({'status':'ERROR','error':'mpv 未就绪'}), 400
	val = request.form.get('value')
	if val is None or val == '':
		cur = mpv_get('volume')
		return jsonify({'status':'OK','volume': cur})
	try:
		f = float(val)
	except ValueError:
		return jsonify({'status':'ERROR','error':'数值非法'}), 400
	if f < 0: f = 0
	if f > 130: f = 130
	if not mpv_set('volume', f):
		return jsonify({'status':'ERROR','error':'设置失败'}), 400
	return jsonify({'status':'OK','volume': f})

# Ensure upload directory exists inside MUSIC_DIR
def _ensure_upload_dir():
    upload_dir = os.path.join(MUSIC_DIR, 'upload')
    try:
        os.makedirs(upload_dir, exist_ok=True)
    except Exception as e:
        print('[WARN] 无法创建 upload 目录:', e)
    return upload_dir

@APP.route('/upload', methods=['POST'])
def api_upload():
    """接受单个文件上传，保存至 MUSIC_DIR/upload，仅允许 ALLOWED 扩展名。"""
    if 'file' not in request.files:
        return jsonify({'status':'ERROR','error':'缺少文件字段 file'}), 400
    f = request.files['file']
    if f.filename == '':
        return jsonify({'status':'ERROR','error':'未选择文件'}), 400
    filename = secure_filename(f.filename)
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED:
        return jsonify({'status':'ERROR','error':'不允许的文件类型'}), 400
    upload_dir = _ensure_upload_dir()
    target = os.path.join(upload_dir, filename)
    
    # 打印上传信息
    size_mb = f.content_length / (1024*1024) if f.content_length else 0
    print(f"[UPLOAD] 接收文件:")
    print(f"- 源文件: {f.filename}")
    print(f"- 大小: {size_mb:.2f}MB")
    print(f"- 类型: {f.content_type}")
    print(f"- 来源IP: {request.remote_addr}")
    print(f"- 目标: {target}")

    # 防止覆盖已有文件：若存在则在文件名后追加数字
    base, e = os.path.splitext(filename)
    i = 1
    while os.path.exists(target):
        filename = f"{base}_{i}{e}"
        target = os.path.join(upload_dir, filename)
        i += 1
        print(f"- 重命名为: {filename} (避免覆盖)")

    try:
        f.save(target)
        print(f"[UPLOAD] 保存成功: {filename}")
    except Exception as e:
        print(f"[UPLOAD] 保存失败: {e}")
        return jsonify({'status':'ERROR','error':f'保存失败: {e}'}), 500
    # Optionally rebuild playlist now or let next playlist scan pick it up
    # We will rebuild the in-memory PLAYLIST so it's immediately visible
    try:
        global PLAYLIST
        PLAYLIST = _build_playlist()
    except Exception:
        pass
    return jsonify({'status':'OK','filename': filename, 'path': os.path.relpath(target, os.path.abspath(MUSIC_DIR)).replace('\\','/')})

print("Build marker:", time.time())

if __name__ == '__main__':
	APP.run(host=cfg.get('FLASK_HOST','0.0.0.0'), port=cfg.get('FLASK_PORT',8000), debug=cfg.get('DEBUG',False))
