"""選角畫面 BGM v2：挑選自己的小球貓——俏皮、可愛、躡手躡腳的貓步感。

C 大調、126 BPM，28 小節（約 53 秒），最後兩小節接回前奏可無縫循環。
  前奏  2 小節：撥弦 + 低音號 oom-pah，木魚帶節奏
  A     8 小節：鋼片琴主旋律（半音鄰音＝貓咪偷偷靠近），卡林巴琶音
  A'    8 小節：同旋律，鼓組進來，結尾往上揚
  B     8 小節：弱音小號唱圓滑的橋段，三角鐵點綴
  尾奏  2 小節：C–A7–Dm7–G7 回前奏
用 fluidsynth + GeneralUser-GS 合成。
"""
from pathlib import Path
import mido

OUT = Path(__file__).resolve().parents[2] / '音樂.音效' / '選角畫面_v2.mid'
TPQ = 480
E = TPQ // 2
BAR = TPQ * 4
BPM = 126

CH = {
    'C': [60, 64, 67], 'Am': [60, 64, 69], 'F': [60, 65, 69], 'G': [59, 62, 67],
    'Dm7': [60, 62, 65, 69], 'G7': [59, 62, 65, 67], 'Em': [59, 64, 67], 'A7': [61, 64, 67, 69],
}
ROOT = {'C': 36, 'Am': 33, 'F': 41, 'G': 43, 'Dm7': 38, 'G7': 43, 'Em': 40, 'A7': 33}

INTRO_H = [[('C', 0, 8)], [('G7', 0, 8)]]
A_H = [[('C', 0, 8)], [('Am', 0, 8)], [('F', 0, 8)], [('G', 0, 8)],
       [('C', 0, 8)], [('Am', 0, 8)], [('Dm7', 0, 4), ('G7', 4, 4)], [('C', 0, 8)]]
B_H = [[('F', 0, 8)], [('G', 0, 8)], [('Em', 0, 8)], [('Am', 0, 8)],
       [('F', 0, 8)], [('G', 0, 8)], [('Dm7', 0, 8)], [('G7', 0, 8)]]
TAG_H = [[('C', 0, 4), ('A7', 4, 4)], [('Dm7', 0, 4), ('G7', 4, 4)]]
HARMONY = INTRO_H + A_H + A_H + B_H + TAG_H      # 28 小節

A_M = [
    [(76, 0, 1), (75, 1, 1), (76, 2, 1), (79, 3, 1), (84, 4, 2), (79, 6, 2)],
    [(81, 0, 1), (80, 1, 1), (81, 2, 1), (84, 3, 1), (76, 4, 2), (72, 6, 2)],
    [(77, 0, 1), (76, 1, 1), (77, 2, 1), (81, 3, 1), (84, 4, 1), (81, 5, 1), (77, 6, 2)],
    [(79, 0, 2), (74, 2, 2), (71, 4, 2), (67, 6, 2)],
    [(76, 0, 1), (75, 1, 1), (76, 2, 1), (79, 3, 1), (84, 4, 2), (79, 6, 2)],
    [(81, 0, 1), (83, 1, 1), (84, 2, 2), (88, 4, 2), (84, 6, 2)],
    [(86, 0, 2), (84, 2, 2), (83, 4, 2), (79, 6, 2)],
    [(84, 0, 2), (79, 2, 1), (76, 3, 1), (72, 4, 2)],
]
A2_M = A_M[:7] + [[(84, 0, 1), (86, 1, 1), (88, 2, 2), (84, 4, 2)]]
B_M = [
    [(72, 0, 2), (77, 2, 2), (81, 4, 4)],
    [(79, 0, 2), (74, 2, 2), (71, 4, 4)],
    [(71, 0, 2), (76, 2, 2), (79, 4, 2), (83, 6, 2)],
    [(81, 0, 6), (76, 6, 2)],
    [(77, 0, 1), (79, 1, 1), (81, 2, 2), (84, 4, 2), (81, 6, 2)],
    [(83, 0, 1), (84, 1, 1), (86, 2, 2), (83, 4, 2), (79, 6, 2)],
    [(77, 0, 2), (81, 2, 2), (84, 4, 2), (86, 6, 2)],
    [(83, 0, 4), (79, 4, 1), (77, 5, 1), (74, 6, 1), (71, 7, 1)],
]
TAG_M = [[(72, 0, 2), (76, 2, 2), (73, 4, 2), (76, 6, 2)],
         [(77, 0, 2), (74, 2, 2), (79, 4, 2), (83, 6, 2)]]


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
        cond.append(mido.MetaMessage('track_name', name='Character Select BGM v2', time=0))
        cond.append(mido.MetaMessage('set_tempo', tempo=mido.bpm2tempo(BPM), time=0))
        cond.append(mido.MetaMessage('time_signature', numerator=4, denominator=4, time=0))
        cond.append(mido.MetaMessage('key_signature', key='C', time=0))
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
    s.tr('Celesta', 0, 8)
    s.tr('Muted Trumpet', 1, 59)
    s.tr('Kalimba', 2, 108)
    s.tr('Pizzicato', 3, 45)
    s.tr('Tuba', 4, 58)
    s.tr('Drums', 9, 0)

    INTRO, A1, A2, B, TAG = 0, 2, 10, 18, 26

    def place(track, melody, bar0, vel, staccato=False):
        for i, bar in enumerate(melody):
            b0 = (bar0 + i) * BAR
            for p, st, ln in bar:
                end = b0 + (st + ln) * E - 30
                if staccato and ln == 1:
                    end = b0 + st * E + E // 2   # 一拍以內的音用跳音，躡手躡腳
                s.note(track, p, b0 + st * E, end, vel)

    place('Celesta', A_M, A1, 100, staccato=True)
    place('Celesta', A2_M, A2, 104, staccato=True)
    place('Muted Trumpet', B_M, B, 92)
    place('Celesta', TAG_M, TAG, 96)

    for bar, chords in enumerate(HARMONY):
        b0 = bar * BAR
        for name, st, ln in chords:
            r = ROOT[name]
            # 低音號 oom-pah：每兩拍一次，根音／五度交替
            for k in range(0, ln, 4):
                p = r if (k // 4) % 2 == 0 else r + 7
                s.note('Tuba', p, b0 + (st + k) * E, b0 + (st + k) * E + E + 40, 90)
            # 撥弦：反拍跳音和弦
            for k in range(st, st + ln):
                if k % 2 == 1:
                    for p in CH[name]:
                        s.note('Pizzicato', p, b0 + k * E, b0 + k * E + E // 2, 72)
            # 卡林巴：A／A' 的八分音符琶音（上行再下行）
            if A1 <= bar < B:
                tones = [p + 12 for p in CH[name]]
                cyc = tones + list(reversed(tones))[1:-1]
                for k in range(ln):
                    at = b0 + (st + k) * E
                    s.note('Kalimba', cyc[k % len(cyc)], at, at + E, 54)

    KICK, SNARE, CLAVES, WB_HI, WB_LO, TRI, CRASH = 36, 38, 75, 76, 77, 81, 49
    d = lambda p, at, v: s.note('Drums', p, at, at + 60, v)
    for bar in range(len(HARMONY)):
        b0 = bar * BAR
        # 木魚：高低交替的「滴答」貓步
        for i in range(8):
            if i % 2 == 1 or bar < A1:
                d(WB_HI if (i // 2) % 2 == 0 else WB_LO, b0 + i * E, 62)
        if bar < A1:
            continue
        if bar in (B,):
            d(CRASH, b0, 64)
        if B <= bar < TAG:
            d(TRI, b0, 70)
        if bar >= A2:
            d(KICK, b0, 80)
            d(KICK, b0 + 2 * TPQ, 74)
            d(SNARE, b0 + TPQ, 60)
            d(SNARE, b0 + 3 * TPQ, 66)
        else:
            d(CLAVES, b0 + 3 * TPQ, 70)
        if bar in (A2 - 1, B - 1, len(HARMONY) - 1):
            for k in range(4):
                d(SNARE, b0 + 3 * TPQ + k * (TPQ // 4), 58 + k * 8)

    total = len(HARMONY) * BAR
    s.save(OUT, total)
    print(f'wrote {OUT}  ({len(HARMONY)} bars, {len(HARMONY) * 4 * 60 / BPM:.1f} s)')


if __name__ == '__main__':
    build()
