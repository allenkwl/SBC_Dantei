"""開場主畫面 BGM v3：輕鬆歡樂 → 最後衝上「當上大富翁」的興奮感。

F 大調、132 BPM、34 小節（約 62 秒），結尾用 C7 轉回開頭，可以無縫循環。
  前奏  2 小節：火車汽笛式的號角動機
  A     8 小節：木琴主旋律、鋼琴反拍、低音 oom-pah，輕快跳躍
  A'    8 小節：同旋律，加鐵琴對位、鼓組完整進來
  B     8 小節：長笛帶旋律一路往上爬，弦樂鋪底、銅管點綴，逐步加溫
  高潮  8 小節：銅管齊奏主旋律（高八度）、鈴鼓、鈸——「發財了！」
輸出給 GarageBand 匯入用：每一軌一種音色，軌名就是建議的 GarageBand 音色。
"""
from pathlib import Path
import mido

OUT = Path(__file__).resolve().parents[2] / '音樂.音效' / '開場主畫面_v3.mid'
TPQ = 480
E = TPQ // 2          # 八分音符
BAR = TPQ * 4
BPM = 132

# ── 和聲（每小節一個或兩個和弦，(和弦名, 起始八分, 長度八分)）──
CH = {
    'F': [57, 60, 65], 'Dm': [57, 62, 65], 'Bb': [58, 62, 65], 'C': [55, 60, 64],
    'Gm': [55, 58, 62], 'Am': [57, 60, 64], 'C7': [55, 58, 64], 'Gm7': [53, 58, 62],
    'F/A': [57, 60, 65], 'Csus': [55, 60, 65],
}
ROOT = {'F': 41, 'Dm': 38, 'Bb': 34, 'C': 36, 'Gm': 43, 'Am': 45, 'C7': 36,
        'Gm7': 43, 'F/A': 45, 'Csus': 36}

INTRO_H = [[('F', 0, 8)], [('F', 0, 4), ('C7', 4, 4)]]
A_H = [[('F', 0, 8)], [('Dm', 0, 8)], [('Bb', 0, 8)], [('C', 0, 8)],
       [('F', 0, 8)], [('Dm', 0, 8)], [('Gm', 0, 4), ('C', 4, 4)], [('F', 0, 8)]]
B_H = [[('Bb', 0, 8)], [('C', 0, 8)], [('Am', 0, 8)], [('Dm', 0, 8)],
       [('Bb', 0, 8)], [('C', 0, 8)], [('Gm7', 0, 8)], [('C7', 0, 8)]]
CLIMAX_H = [[('F', 0, 8)], [('Dm', 0, 8)], [('Bb', 0, 8)], [('C', 0, 8)],
            [('F/A', 0, 8)], [('Bb', 0, 8)], [('Csus', 0, 4), ('C7', 4, 4)],
            [('F', 0, 4), ('C7', 4, 4)]]
HARMONY = INTRO_H + A_H + A_H + B_H + CLIMAX_H   # 34 小節

# ── 旋律（(音高, 起始八分, 長度八分)）──
INTRO_M = [[(72, 0, 1), (77, 1, 3), (72, 4, 1), (77, 5, 3)],
           [(79, 0, 1), (81, 1, 1), (82, 2, 1), (84, 3, 3), (79, 6, 2)]]
A_M = [
    [(72, 0, 1), (69, 1, 1), (72, 2, 1), (77, 3, 2), (76, 5, 1), (74, 6, 2)],
    [(74, 0, 1), (72, 1, 1), (69, 2, 2), (65, 4, 2), (69, 6, 2)],
    [(70, 0, 1), (74, 1, 1), (77, 2, 1), (79, 3, 2), (77, 5, 1), (74, 6, 2)],
    [(76, 0, 3), (72, 3, 1), (74, 4, 1), (76, 5, 1), (79, 6, 2)],
    [(72, 0, 1), (69, 1, 1), (72, 2, 1), (77, 3, 2), (76, 5, 1), (74, 6, 2)],
    [(74, 0, 1), (77, 1, 1), (81, 2, 2), (79, 4, 1), (77, 5, 1), (74, 6, 2)],
    [(70, 0, 2), (74, 2, 2), (76, 4, 1), (79, 5, 1), (76, 6, 1), (72, 7, 1)],
    [(77, 0, 3), (72, 3, 1), (77, 4, 4)],
]
B_M = [
    [(77, 0, 1), (79, 1, 1), (81, 2, 2), (77, 4, 2), (74, 6, 2)],
    [(79, 0, 1), (81, 1, 1), (82, 2, 2), (79, 4, 2), (76, 6, 2)],
    [(81, 0, 1), (84, 1, 1), (81, 2, 1), (76, 3, 1), (72, 4, 2), (76, 6, 2)],
    [(77, 0, 2), (74, 2, 2), (81, 4, 4)],
    [(82, 0, 1), (81, 1, 1), (79, 2, 1), (77, 3, 1), (74, 4, 2), (77, 6, 2)],
    [(79, 0, 1), (77, 1, 1), (76, 2, 1), (74, 3, 1), (72, 4, 2), (76, 6, 2)],
    [(74, 0, 2), (77, 2, 2), (82, 4, 2), (79, 6, 2)],
    [(84, 0, 4), (72, 4, 1), (76, 5, 1), (79, 6, 1), (82, 7, 1)],
]
# 高潮：主旋律最後兩小節改成往上衝、停在高音 F，再用小號吹轉回前奏
CLIMAX_M = A_M[:6] + [
    [(74, 0, 1), (77, 1, 1), (79, 2, 2), (81, 4, 1), (82, 5, 1), (84, 6, 2)],
    [(89, 0, 4), (84, 4, 1), (82, 5, 1), (79, 6, 1), (76, 7, 1)],
]
# 鐵琴對位（A'、高潮用）：每小節和弦內音的閃亮琶音
def sparkle(h_bar):
    out = []
    for name, s, l in h_bar:
        tones = [p + 24 for p in CH[name]]
        for i in range(l):
            if i % 2 == 1:
                out.append((tones[(i // 2) % 3], s + i, 1))
    return out


def bars_offset(i):
    return i * BAR


class Song:
    def __init__(self):
        self.tracks = {}

    def tr(self, name, ch, prog):
        if name not in self.tracks:
            self.tracks[name] = (ch, prog, [])
        return self.tracks[name][2]

    def note(self, name, pitch, start, length, vel):
        ev = self.tracks[name][2]
        ev.append((start, 'note_on', pitch, vel))
        ev.append((start + length, 'note_off', pitch, 0))

    def save(self, path):
        mid = mido.MidiFile(ticks_per_beat=TPQ)
        cond = mido.MidiTrack()
        cond.append(mido.MetaMessage('track_name', name='Splash BGM v3', time=0))
        cond.append(mido.MetaMessage('set_tempo', tempo=mido.bpm2tempo(BPM), time=0))
        cond.append(mido.MetaMessage('time_signature', numerator=4, denominator=4, time=0))
        cond.append(mido.MetaMessage('key_signature', key='F', time=0))
        cond.append(mido.MetaMessage('end_of_track', time=len(HARMONY) * BAR))
        mid.tracks.append(cond)
        for name, (ch, prog, ev) in self.tracks.items():
            t = mido.MidiTrack()
            t.append(mido.MetaMessage('track_name', name=name, time=0))
            if ch != 9:
                t.append(mido.Message('program_change', channel=ch, program=prog, time=0))
            ev.sort(key=lambda e: (e[0], 0 if e[1] == 'note_off' else 1))
            now = 0
            for tick, kind, p, v in ev:
                t.append(mido.Message(kind, channel=ch, note=p, velocity=v, time=tick - now))
                now = tick
            t.append(mido.MetaMessage('end_of_track', time=max(0, len(HARMONY) * BAR - now)))
            mid.tracks.append(t)
        mid.save(path)


def build():
    s = Song()
    s.tr('Lead Mallet (Marimba)', 0, 12)
    s.tr('Lead Flute', 1, 73)
    s.tr('Lead Brass', 2, 61)
    s.tr('Trumpet Fanfare', 3, 56)
    s.tr('Glockenspiel', 4, 9)
    s.tr('Piano Bounce', 5, 0)
    s.tr('Strings', 6, 48)
    s.tr('Bass', 7, 33)
    s.tr('Drums', 9, 0)

    INTRO, A1, A2, B, CL = 0, 2, 10, 18, 26   # 段落起始小節

    def place(track, melody, bar0, vel, octave=0):
        for i, bar in enumerate(melody):
            for p, st, ln in bar:
                s.note(track, p + octave, bars_offset(bar0 + i) + st * E,
                       ln * E - 20, vel)

    # 前奏：小號吹汽笛動機
    place('Trumpet Fanfare', INTRO_M, INTRO, 100)
    # A／A'：木琴主旋律
    place('Lead Mallet (Marimba)', A_M, A1, 96)
    place('Lead Mallet (Marimba)', A_M, A2, 100)
    # B：長笛
    place('Lead Flute', B_M, B, 92)
    # 高潮：銅管齊奏 + 木琴高八度加亮
    place('Lead Brass', CLIMAX_M, CL, 110)
    place('Lead Mallet (Marimba)', CLIMAX_M, CL, 84, octave=12)

    # 鐵琴對位
    for bar in list(range(A2, A2 + 8)) + list(range(CL, CL + 8)):
        place('Glockenspiel', [sparkle(HARMONY[bar])], bar, 64)

    for bar, chords in enumerate(HARMONY):
        b0 = bars_offset(bar)
        for name, st, ln in chords:
            # 鋼琴：反拍跳音（前奏用整拍和弦）
            for i in range(ln):
                pos = st + i
                if bar < A1:
                    if i % 2 == 0:
                        for p in CH[name]:
                            s.note('Piano Bounce', p, b0 + pos * E, E - 40, 78)
                elif i % 2 == 1:
                    vel = 88 if bar >= CL else 74
                    for p in CH[name]:
                        s.note('Piano Bounce', p, b0 + pos * E, E // 2, vel)
            # 低音：根音／五度 oom-pah，每兩拍一換
            r = ROOT[name]
            for i in range(0, ln, 2):
                p = r if (i // 2) % 2 == 0 else r + 7
                s.note('Bass', p, b0 + (st + i) * E, E + E // 2, 96)
            # 弦樂：B 與高潮鋪長音
            if bar >= B:
                vel = 70 if bar < CL else 84
                for p in CH[name] + [CH[name][0] + 12]:
                    s.note('Strings', p, b0 + st * E, ln * E - 10, vel)
        # 銅管重音：B 段每小節第一拍、高潮第一拍和第三拍後半
        if B <= bar < CL:
            name = chords[0][0]
            for p in CH[name]:
                s.note('Trumpet Fanfare', p + 12, b0, E, 84)
        if bar >= CL and bar < len(HARMONY) - 1:
            name = chords[-1][0]
            for p in CH[name]:
                s.note('Trumpet Fanfare', p + 12, b0 + 5 * E, E - 30, 92)

    # ── 鼓組 ──
    KICK, SNARE, STICK, HAT, OHAT, CRASH, TAMB, TOM_H, TOM_M, TOM_L, CLAP = \
        36, 38, 37, 42, 46, 49, 54, 50, 47, 43, 39
    d = lambda p, t, v: s.note('Drums', p, t, E // 2, v)
    for bar in range(len(HARMONY)):
        b0 = bars_offset(bar)
        last = bar == len(HARMONY) - 1
        if bar < A1:                          # 前奏：大鼓四拍 + 小鼓漸強
            for q in range(4):
                d(KICK, b0 + q * TPQ, 90)
            if bar == A1 - 1:
                for i in range(8):
                    d(SNARE, b0 + i * E, 60 + i * 6)
            continue
        if bar in (A1, A2, B, CL):
            d(CRASH, b0, 100 if bar == CL else 84)
        lite = bar < A2
        for q in range(4):
            if q in (0, 2):
                d(KICK, b0 + q * TPQ, 100)
            else:
                d(STICK if lite else SNARE, b0 + q * TPQ, 70 if lite else 92)
                if bar >= CL:
                    d(CLAP, b0 + q * TPQ, 80)
        if bar >= B:
            d(KICK, b0 + 7 * E, 80)               # 第四拍後半的推進大鼓
        for i in range(8):
            if bar >= CL:
                d(TAMB, b0 + i * E, 70 if i % 2 else 84)
            hp = OHAT if (bar >= B and i == 7) else HAT
            d(hp, b0 + i * E, 58 if i % 2 else 72)
        # 段落結尾過門
        if bar in (A2 - 1, B - 1):
            for i, p in enumerate([TOM_H, TOM_H, TOM_M, TOM_L]):
                d(p, b0 + 3 * TPQ + i * (TPQ // 4), 90)
        if bar == CL - 1:                          # 進高潮：小鼓十六分音符漸強
            for i in range(8):
                d(SNARE, b0 + 2 * TPQ + i * (TPQ // 4), 70 + i * 6)
        if last:                                   # 循環接回前奏
            for i, p in enumerate([SNARE, SNARE, TOM_H, TOM_M, TOM_L, TOM_L]):
                d(p, b0 + 2 * TPQ + i * (TPQ // 3), 88)

    s.save(OUT)
    print(f'wrote {OUT}  ({len(HARMONY)} bars, {len(HARMONY) * 4 * 60 / BPM:.1f} s)')


if __name__ == '__main__':
    build()
