"""連線大廳 BGM v2：等朋友上線、邊聊邊等的輕快流行風。

G 大調、108 BPM、直八分，28 小節（約 62 秒），最後兩小節接回前奏可無縫循環。
  前奏  2 小節：尼龍吉他刷弦 + 低音
  A     8 小節：陶笛主旋律、吉他刷弦、沙鈴與拍手
  A'    8 小節：同旋律，馬林巴加反拍和弦，結尾改成往下收
  B     8 小節：旋律往高處走，弦樂鋪底、鐵琴點綴、鼓組完整
  尾奏  2 小節：G–Em–Am7–D7 回前奏
用 fluidsynth + GeneralUser-GS 合成。
"""
from pathlib import Path
import mido

OUT = Path(__file__).resolve().parents[2] / '音樂.音效' / '連線大廳_v2.mid'
TPQ = 480
E = TPQ // 2
BAR = TPQ * 4
BPM = 108

CH = {
    'G': [55, 59, 62, 67], 'Em': [55, 59, 64, 67], 'C': [55, 60, 64, 67],
    'D': [54, 57, 62, 66], 'Am7': [55, 60, 64, 69], 'D7': [54, 57, 60, 62],
    'Bm': [54, 59, 62, 66],
}
ROOT = {'G': 43, 'Em': 40, 'C': 36, 'D': 38, 'Am7': 45, 'D7': 38, 'Bm': 35}

INTRO_H = [[('G', 0, 8)], [('D7', 0, 8)]]
A_H = [[('G', 0, 8)], [('Em', 0, 8)], [('C', 0, 8)], [('D', 0, 8)],
       [('G', 0, 8)], [('Em', 0, 8)], [('Am7', 0, 4), ('D7', 4, 4)], [('G', 0, 8)]]
B_H = [[('C', 0, 8)], [('D', 0, 8)], [('Bm', 0, 8)], [('Em', 0, 8)],
       [('C', 0, 8)], [('D', 0, 8)], [('Am7', 0, 8)], [('D7', 0, 8)]]
TAG_H = [[('G', 0, 4), ('Em', 4, 4)], [('Am7', 0, 4), ('D7', 4, 4)]]
HARMONY = INTRO_H + A_H + A_H + B_H + TAG_H      # 28 小節

A_M = [
    [(71, 0, 1), (74, 1, 1), (79, 2, 2), (78, 4, 1), (76, 5, 1), (74, 6, 2)],
    [(71, 0, 2), (76, 2, 2), (79, 4, 2), (76, 6, 2)],
    [(72, 0, 1), (76, 1, 1), (79, 2, 1), (81, 3, 2), (79, 5, 1), (76, 6, 2)],
    [(78, 0, 3), (74, 3, 1), (69, 4, 4)],
    [(71, 0, 1), (74, 1, 1), (79, 2, 2), (81, 4, 1), (83, 5, 1), (81, 6, 2)],
    [(79, 0, 2), (76, 2, 1), (79, 3, 1), (83, 4, 4)],
    [(81, 0, 2), (79, 2, 2), (78, 4, 2), (74, 6, 2)],
    [(79, 0, 6)],
]
A2_M = A_M[:7] + [[(79, 0, 2), (74, 2, 2), (71, 4, 2), (74, 6, 2)]]
B_M = [
    [(76, 0, 2), (79, 2, 2), (84, 4, 4)],
    [(83, 0, 1), (81, 1, 1), (78, 2, 2), (74, 4, 4)],
    [(74, 0, 1), (78, 1, 1), (81, 2, 2), (83, 4, 2), (81, 6, 2)],
    [(79, 0, 4), (76, 4, 2), (71, 6, 2)],
    [(72, 0, 1), (76, 1, 1), (79, 2, 2), (84, 4, 1), (83, 5, 1), (81, 6, 2)],
    [(78, 0, 2), (81, 2, 2), (86, 4, 4)],
    [(84, 0, 2), (81, 2, 2), (76, 4, 2), (72, 6, 2)],
    [(74, 0, 2), (78, 2, 2), (81, 4, 2), (84, 6, 2)],
]
TAG_M = [[(83, 0, 4), (79, 4, 4)],
         [(76, 0, 2), (72, 2, 2), (74, 4, 2), (78, 6, 2)]]


class Song:
    def __init__(self):
        self.tracks = {}

    def tr(self, name, ch, prog):
        self.tracks[name] = (ch, prog, [])

    def note(self, name, pitch, start, end, vel):
        ev = self.tracks[name][2]
        ev.append((start, 'note_on', pitch, vel))
        ev.append((max(start + 30, end), 'note_off', pitch, 0))

    def save(self, path, total):
        mid = mido.MidiFile(ticks_per_beat=TPQ)
        cond = mido.MidiTrack()
        cond.append(mido.MetaMessage('track_name', name='Lobby BGM v2', time=0))
        cond.append(mido.MetaMessage('set_tempo', tempo=mido.bpm2tempo(BPM), time=0))
        cond.append(mido.MetaMessage('time_signature', numerator=4, denominator=4, time=0))
        cond.append(mido.MetaMessage('key_signature', key='G', time=0))
        cond.append(mido.MetaMessage('end_of_track', time=total))
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
            t.append(mido.MetaMessage('end_of_track', time=max(0, total - now)))
            mid.tracks.append(t)
        mid.save(path)


def build():
    s = Song()
    s.tr('Ocarina', 0, 79)
    s.tr('Nylon Guitar', 1, 24)
    s.tr('Marimba', 2, 12)
    s.tr('Glockenspiel', 3, 9)
    s.tr('Strings', 4, 48)
    s.tr('Bass', 5, 33)
    s.tr('Drums', 9, 0)

    INTRO, A1, A2, B, TAG = 0, 2, 10, 18, 26

    def place(track, melody, bar0, vel, octave=0):
        for i, bar in enumerate(melody):
            b0 = (bar0 + i) * BAR
            for p, st, ln in bar:
                s.note(track, p + octave, b0 + st * E, b0 + (st + ln) * E - 30, vel)

    place('Ocarina', A_M, A1, 96)
    place('Ocarina', A2_M, A2, 98)
    place('Ocarina', B_M, B, 100)
    place('Ocarina', TAG_M, TAG, 94)

    STRUM = [(0, 'D', 84), (2, 'D', 72), (3, 'U', 62), (5, 'U', 64), (6, 'D', 74), (7, 'U', 60)]
    for bar, chords in enumerate(HARMONY):
        b0 = bar * BAR
        for name, st, ln in chords:
            # 尼龍吉他：D-DU-UDU 刷弦，下刷由低到高、上刷由高到低，每弦錯開 12 tick
            for pos, way, vel in STRUM:
                if not (st <= pos < st + ln):
                    continue
                notes = CH[name] if way == 'D' else list(reversed(CH[name]))
                for k, p in enumerate(notes):
                    at = b0 + pos * E + k * 12
                    s.note('Nylon Guitar', p, at, b0 + (pos + 1) * E + 60, vel - k * 3)
            # 低音：整小節「根音 → 八度 → 五度 → 根音」；半小節「根音 → 五度」
            r = ROOT[name]
            pattern = [(0, r), (3, r + 12), (4, r + 7), (6, r)] if ln == 8 else [(0, r), (2, r + 7)]
            for off, p in pattern:
                at = b0 + (st + off) * E
                s.note('Bass', p, at, at + E - 30, 92 if off == 0 else 78)
            # 馬林巴：A' 與 B 的反拍和弦
            if bar >= A2 and bar < TAG:
                for k in range(st, st + ln):
                    if k % 2 == 1:
                        for p in CH[name][1:]:
                            s.note('Marimba', p + 12, b0 + k * E, b0 + k * E + E - 40, 58)
            # 弦樂：B 與尾奏鋪長音
            if bar >= B:
                for p in CH[name]:
                    s.note('Strings', p, b0 + st * E, b0 + (st + ln) * E - 10, 62)
            # 鐵琴：B 段每小節第一拍與第三拍點和弦高音
            if B <= bar < TAG:
                for k in (st, st + 4):
                    if k < st + ln:
                        s.note('Glockenspiel', CH[name][-1] + 24, b0 + k * E, b0 + k * E + E, 60)

    KICK, SNARE, CLAP, HAT, OHAT, CRASH, SHAKER, TOM_H, TOM_L = 36, 38, 39, 42, 46, 49, 70, 50, 45
    d = lambda p, at, v: s.note('Drums', p, at, at + 60, v)
    for bar in range(len(HARMONY)):
        b0 = bar * BAR
        if bar in (A1, B):
            d(CRASH, b0, 80)
        for i in range(8):
            d(SHAKER, b0 + i * E, 64 if i % 2 else 50)
        if bar < A1:
            continue
        for pos in (0, 3, 4):
            d(KICK, b0 + pos * E, 88 if pos != 3 else 70)
        for q in (1, 3):
            d(CLAP, b0 + q * TPQ, 76)
            if bar >= B:
                d(SNARE, b0 + q * TPQ, 70)
        if bar >= A2:
            for i in range(8):
                d(OHAT if (bar >= B and i == 7) else HAT, b0 + i * E, 56 if i % 2 else 66)
        if bar in (A2 - 1, B - 1, len(HARMONY) - 1):
            for k, p in enumerate([SNARE, TOM_H, TOM_L, TOM_L]):
                d(p, b0 + 3 * TPQ + k * (TPQ // 4), 80)

    total = len(HARMONY) * BAR
    s.save(OUT, total)
    print(f'wrote {OUT}  ({len(HARMONY)} bars, {len(HARMONY) * 4 * 60 / BPM:.1f} s)')


if __name__ == '__main__':
    build()
