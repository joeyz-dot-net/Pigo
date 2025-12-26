# -*- coding: utf-8 -*-
"""测试 VB-Cable 音频采集"""
import sounddevice as sd
import numpy as np

# 查找 CABLE Output 设备
devices = sd.query_devices()
print('所有音频设备:')
for i, d in enumerate(devices):
    if 'CABLE' in d['name']:
        print(f"  [{i}] {d['name']} (输入: {d['max_input_channels']}ch, 输出: {d['max_output_channels']}ch)")

# 尝试从 CABLE Output 录制3秒
print()
print('从 CABLE Output (设备 9) 录制 3 秒...')
print('请确保 MPV 正在播放音乐到 CABLE Input!')
print()

try:
    recording = sd.rec(int(48000 * 3), samplerate=48000, channels=2, dtype='int16', device=9)
    sd.wait()
    max_level = np.max(np.abs(recording))
    print(f'录制完成! 最大电平: {max_level}')
    if max_level == 0:
        print('❌ 没有检测到任何音频!')
        print()
        print('可能原因:')
        print('1. VB-Cable 没有安装或未正确工作')
        print('2. MPV 没有输出到 CABLE Input')
        print('3. Windows 音频设置中 CABLE Input 被静音')
    else:
        print('✓ 检测到音频!')
except Exception as e:
    print(f'录制失败: {e}')
