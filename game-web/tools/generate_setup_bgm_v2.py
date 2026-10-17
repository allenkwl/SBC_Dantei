"""遊戲設定（選人數）畫面 BGM v2：搖擺節奏的「準備出發」——輕鬆、帶點期待。

降 B 大調、120 BPM、搖擺八分音符，28 小節（56 秒），最後兩小節 turnaround 接回開頭可無縫循環。
  前奏  2 小節：顫音琴琶音 + 低音
  A     8 小節：單簧管主旋律、撥弦 Charleston 節奏、行走低音、刷子鼓
  A'    8 小節：同旋律，顫音琴加對位，結尾變化
  B     8 小節：中音薩克斯帶橋段，電鋼琴補和聲，稍微加溫
  轉回  2 小節：Bb–G7–Cm7–F7 turnaround
用 fluidsynth + GeneralUser-GS 合成（使用者偏好音色庫直出）。
"""
from pathlib import Path
import mido

OUT = Path(__file__).resolve().parents[2] / '音樂.音效' / '遊戲設定畫面_v2.mid'
TPQ = 480
BAR = TPQ * 4
BPM = 120
SWING = TPQ * 2 // 3          # 反拍延後到三連音第三個


def t8(i):
    """第 i 個（搖擺）八分音符位置。"""
    return (i // 2) * TPQ + (SWING if i % 2 else 0)


CH = {
    'Bb': [58, 62, 65, 69], 'Gm': [58, 62, 65, 67], 'Cm7': [58, 63, 67, 72],
    'F7': [57, 60, 63, 65], 'Eb': [58, 63, 67, 70], 'G7': [59, 62, 65, 67],
}
ROOT = {'Bb': 34, 'Gm': 43, 'Cm7': 36, 'F7': 41, 'Eb': 39, 'G7': 43}
THIRD = {'Bb': 4, 'Gm': 3, 'Cm7': 3, 'F7': 4, 'Eb': 4, 'G7': 4}

INTRO_H = [[('Bb', 0, 8)], [('F7', 0, 8)]]
A_H = [[('Bb', 0, 8)], [('Gm', 0, 8)], [('Cm7', 0, 8)], [('F7', 0, 8)],
       [('Bb', 0, 8)], [('Eb', 0, 8)], [('Cm7', 0, 4), ('F7', 4, 4)], [('Bb', 0, 8)]]
B_H = [[('Eb', 0, 8)], [('Bb', 0, 8)], [('Cm7', 0, 8)], [('F7', 0, 8)],
       [('Eb', 0, 8)], [('Bb', 0, 8)], [('G7', 0, 8)], [('Cm7', 0, 4), ('F7', 4, 4)]]
TURN_H = [[('Bb', 0, 4), ('G7', 4, 4)], [('Cm7', 0, 4), ('F7', 4, 4)]]
HARMONY = INTRO_H + A_H + A_H + B_H + TURN_H     # 28 小節

A_M = [
    [(74, 0, 1), (77, 1, 1), (82, 2, 2), (79, 4, 1), (77, 5, 3)],
    [(79, 0, 1), (77, 1, 1), (74, 2, 2), (70, 4, 4)],
    [(72, 0, 1), (75, 1, 1), (79, 2, 2), (77, 4, 1), (75, 5, 1), (72, 6, 2)],
    [(74, 0, 3), (72, 3, 1), (69, 4, 2), (65, 6, 2)],
    [(74, 0, 1), (77, 1, 1), (82, 2, 2), (84, 4, 1), (82, 5, 1), (79, 6, 2)],
    [(79, 0, 2), (75, 2, 1), (79, 3, 1), (82, 4, 4)],
    [(84, 0, 2), (82, 2, 2), (81, 4, 2), (77, 6, 2)],
    [(82, 0, 4), (77, 4, 2), (74, 6, 2)],
]
A2_M = A_M[:6] + [
    [(84, 0, 1), (86, 1, 1), (84, 2, 2), (81, 4, 2), (77, 6, 2)],
    [(82, 0, 6)],
]
B_M = [
    [(79, 0, 2), (82, 2, 2), (87, 4, 4)],
    [(86, 0, 1), (84, 1, 1), (82, 2, 2), (77, 4, 4)],
    [(75, 0, 1), (79, 1, 1), (82, 2, 2), (84, 4, 2), (82, 6, 2)],
    [(81, 0, 4), (77, 4, 2), (72, 6, 2)],
    [(79, 0, 1), (82, 1, 1), (87, 2, 2), (86, 4, 1), (84, 5, 1), (82, 6, 2)],
    [(82, 0, 2), (86, 2, 2), (89, 4, 4)],
    [(83, 0, 2), (86, 2, 2), (83, 4, 2), (79, 6, 2)],
    [(84, 0, 4), (81, 4, 2), (77, 6, 2)],
]
TURN_M = [[(82, 0, 2), (79, 2, 2), (77, 4, 2), (74, 6, 2)],
          [(72, 0, 2), (75, 2, 2), (77, 4, 2), (81, 6, 2)]]


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
        cond.append(mido.MetaMessage('track_name', name='Setup BGM v2', time=0))
        cond.append(mido.MetaMessage('set_tempo', tempo=mido.bpm2tempo(BPM), time=0))
        cond.append(mido.MetaMessage('time_signature', numerator=4, denominator=4, time=0))
        cond.append(mido.MetaMessage('key_signature', key='Bb', time=0))
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
    s.tr('Clarinet', 0, 71)
    s.tr('Alto Sax', 1, 65)
    s.tr('Vibraphone', 2, 11)
    s.tr('Pizzicato', 3, 45)
    s.tr('E.Piano', 4, 4)
    s.tr('Bass', 5, 32)
    s.tr('Drums', 9, 0)

    INTRO, A1, A2, B, TURN = 0, 2, 10, 18, 26

    def place(track, melody, bar0, vel, octave=0, legato=0.92):
        for i, bar in enumerate(melody):
            b0 = (bar0 + i) * BAR
            for p, st, ln in bar:
                start, end = b0 + t8(st), b0 + t8(st + ln)
                s.note(track, p + octave, start, start + int((end - start) * legato), vel)

    place('Clarinet', A_M, A1, 92)
    place('Clarinet', A2_M, A2, 94)
    place('Alto Sax', B_M, B, 90)
    place('Clarinet', TURN_M, TURN, 88)

    for bar, chords in enumerate(HARMONY):
        b0 = bar * BAR
        nxt = HARMONY[(bar + 1) % len(HARMONY)][0][0]
        for ci, (name, st, ln) in enumerate(chords):
            # 撥弦：Charleston（第一拍＋第二拍後半），兩和弦小節就各打一下
            hits = [st] if ln == 4 else [0, 3]
            for h in hits:
                for p in CH[name]:
                    s.note('Pizzicato', p, b0 + t8(h), b0 + t8(h) + TPQ // 2, 80)
            # 電鋼琴：B 段長音和聲
            if B <= bar < TURN:
                for p in CH[name]:
                    s.note('E.Piano', p + 12, b0 + t8(st), b0 + t8(st + ln) - 20, 58)
            # 行走低音：每拍一音，最後一拍半音趨近下一個和弦
            r = ROOT[name]
            nxt_root = ROOT[chords[ci + 1][0]] if ci + 1 < len(chords) else ROOT[nxt]
            beats = ln // 2
            line = [r, r + THIRD[name], r + 7, nxt_root - 1 if nxt_root - 1 > r else nxt_root + 1]
            if beats == 2:
                line = [r, nxt_root + 1 if nxt_root < r else nxt_root - 1]
            for k in range(beats):
                at = b0 + (st // 2 + k) * TPQ
                s.note('Bass', line[k], at, at + TPQ - 40, 92 if k == 0 else 80)
            # 顫音琴：前奏與 A' 的琶音對位
            if bar < A1 or A2 <= bar < B:
                tones = [p + 12 for p in CH[name]]
                for k in range(ln):
                    if bar >= A2 and k % 2 == 0:
                        continue
                    at = b0 + t8(st + k)
                    s.note('Vibraphone', tones[k % 4], at, at + TPQ // 2, 60 if bar >= A2 else 72)

    # ── 刷子／爵士鼓 ──
    KICK, STICK, SNARE, RIDE, PEDAL, CRASH, TOM_H, TOM_L = 36, 37, 38, 51, 44, 49, 50, 45
    d = lambda p, at, v: s.note('Drums', p, at, at + 60, v)
    for bar in range(len(HARMONY)):
        b0 = bar * BAR
        if bar in (A1, B):
            d(CRASH, b0, 70)
        for q in range(4):
            d(RIDE, b0 + q * TPQ, 70 if q % 2 else 62)
            if q in (1, 3):
                d(RIDE, b0 + q * TPQ + SWING, 56)
                d(PEDAL, b0 + q * TPQ, 60)
            if q in (0, 2) and bar >= A1:
                d(KICK, b0 + q * TPQ, 54)
        if A1 <= bar:
            d(SNARE if bar >= B else STICK, b0 + 3 * TPQ, 66 if bar >= B else 70)
        if bar in (A2 - 1, B - 1, len(HARMONY) - 1):   # 段落尾巴的小過門
            d(SNARE, b0 + 3 * TPQ + SWING, 72)
            d(TOM_H, b0 + 2 * TPQ + SWING, 70)
            d(TOM_L, b0 + 3 * TPQ, 74)

    total = len(HARMONY) * BAR
    s.save(OUT, total)
    print(f'wrote {OUT}  ({len(HARMONY)} bars, {len(HARMONY) * 4 * 60 / BPM:.1f} s)')


if __name__ == '__main__':
    build()
