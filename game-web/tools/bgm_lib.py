"""BGM 編曲小工具：用文字寫旋律與和弦，依段落設定自動配伴奏、低音、鼓組，輸出 MIDI 並用音色庫合成 MP3。

旋律寫法：小節用 | 分隔，每個音「音名:長度」，長度單位是八分音符（省略＝1），r 是休止符。
    例："E5:2 D5 C5 r:4 | G4:8"
和弦寫法：小節用 | 分隔，一小節可放多個和弦（平均分配），支援 m 7 m7 maj7 m6 6 dim dim7 sus4 aug add9 與斜線低音。
    例："C | Am F | Dm7 G7 | D/C"
"""
from pathlib import Path
import re
import subprocess
import mido

TPQ = 480
E = TPQ // 2
ROOT_DIR = Path(__file__).resolve().parents[2]
MUSIC_DIR = ROOT_DIR / '音樂.音效'
SOUNDFONT = MUSIC_DIR / 'soundfont' / 'GeneralUser-GS.sf2'
TARGET_MEAN_DB = -26.3        # 跟已確認的主畫面 v3 B 版一致

PC = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
QUAL = {
    '': [0, 4, 7], 'm': [0, 3, 7], '7': [0, 4, 7, 10], 'm7': [0, 3, 7, 10],
    'maj7': [0, 4, 7, 11], 'm6': [0, 3, 7, 9], '6': [0, 4, 7, 9], 'dim': [0, 3, 6],
    'dim7': [0, 3, 6, 9], 'sus4': [0, 5, 7], 'aug': [0, 4, 8], 'add9': [0, 4, 7, 14],
}


def pc_of(name):
    return (PC[name[0]] + (1 if '#' in name[1:] else -1 if 'b' in name[1:] else 0)) % 12


def pitch(tok):
    m = re.fullmatch(r'([A-G])([#b]?)(-?\d)', tok)
    if not m:
        raise ValueError(f'bad note {tok}')
    return 12 * (int(m.group(3)) + 1) + pc_of(m.group(1) + m.group(2))


def parse_melody(text, bl):
    bars = []
    for chunk in text.split('|'):
        pos, bar = 0, []
        for tok in chunk.split():
            name, _, ln = tok.partition(':')
            ln = int(ln or 1)
            if name != 'r':
                bar.append((pitch(name), pos, ln))
            pos += ln
        if pos != bl:
            raise ValueError(f'小節長度 {pos} ≠ {bl}: {chunk!r}')
        bars.append(bar)
    return bars


def transpose(bars, n):
    return [[(p + n, s, l) for p, s, l in bar] for bar in bars]


class Chord:
    def __init__(self, sym):
        m = re.fullmatch(r'([A-G][#b]?)(.*?)(?:/([A-G][#b]?))?', sym)
        root, qual, slash = m.group(1), m.group(2), m.group(3)
        self.sym = sym
        self.root_pc = pc_of(root)
        self.ivs = QUAL[qual]
        self.third = self.ivs[1]
        bass_pc = pc_of(slash) if slash else self.root_pc
        self.bass = 33 + (bass_pc - 9) % 12          # A1..G#2
        # 收在 G3～F#4 附近的密集和聲
        self.voicing = sorted(55 + (self.root_pc + iv - 55) % 12 for iv in self.ivs)


def parse_harmony(text, bl):
    bars = []
    for chunk in text.split('|'):
        syms = chunk.split()
        n = len(syms)
        step = bl // n
        bars.append([(Chord(s), i * step, step if i < n - 1 else bl - i * step) for i, s in enumerate(syms)])
    return bars


class Song:
    def __init__(self, title, bpm, bar=8, timesig=(4, 4), key='C'):
        self.title, self.bpm, self.bl, self.timesig, self.key = title, bpm, bar, timesig, key
        self.tracks = {}
        self.bar_no = 0

    def track(self, name, ch, prog):
        self.tracks[name] = (ch, prog, [])

    def note(self, name, p, start, end, vel):
        ev = self.tracks[name][2]
        vel = max(1, min(127, int(vel)))
        ev.append((int(start), 'note_on', p, vel))
        ev.append((int(max(start + 30, end)), 'note_off', p, 0))

    # ── 一個段落 ──
    def section(self, h, m=None, lead=None, vel=96, double=None, comp=None, comp2=None,
                bass=None, drums=None, pad=None, counter=None, crash=False, fill=False,
                timp=False, staccato=False):
        bl = self.bl
        H = parse_harmony(h, bl)
        M = (parse_melody(m, bl) if isinstance(m, str) else m) if m else None
        if M is not None and len(M) != len(H):
            raise ValueError(f'旋律 {len(M)} 小節、和弦 {len(H)} 小節對不起來')
        start_bar = self.bar_no
        for i, chords in enumerate(H):
            b0 = (start_bar + i) * bl * E
            last = i == len(H) - 1
            if M is not None and lead:
                for p, st, ln in M[i]:
                    end = b0 + (st + ln) * E - 30
                    if staccato and ln == 1:
                        end = b0 + st * E + E // 2
                    self.note(lead, p, b0 + st * E, end, vel)
                    if double:
                        tr, octv, dv = double
                        self.note(tr, p + octv, b0 + st * E, end, dv)
            for ch, st, ln in chords:
                for c in (comp, comp2):
                    if c:
                        self._comp(c, ch, b0, st, ln)
                if bass:
                    self._bass(bass, ch, b0, st, ln, chords, H[(i + 1) % len(H)][0][0])
                if pad:
                    tr, pv, octv = pad
                    for p in ch.voicing:
                        self.note(tr, p + octv, b0 + st * E, b0 + (st + ln) * E - 10, pv)
                if counter:
                    self._counter(counter, ch, b0, st, ln)
                if timp:
                    r = 41 + (ch.root_pc - 5) % 12      # F2..E3
                    self.note('Timpani', r, b0 + st * E, b0 + st * E + TPQ, 100)
            if drums:
                self._drums(drums, b0, i, crash and i == 0, fill and last)
            if timp and last:
                r = 41 + (chords[-1][0].root_pc - 5) % 12
                for k in range(8):
                    at = b0 + (bl - 2) * E + k * (E // 4)
                    self.note('Timpani', r, at, at + E // 4, 60 + k * 6)
        self.bar_no += len(H)

    def _comp(self, c, ch, b0, st, ln):
        style, tr, v = c
        V = ch.voicing
        n = lambda p, a, l, vv=v: self.note(tr, p, b0 + a, b0 + a + l, vv)
        if style == 'offbeat':
            for k in range(st, st + ln):
                if k % 2 == 1:
                    for p in V:
                        n(p, k * E, E // 2)
        elif style == 'strum':
            for pos, way, dv in [(0, 'D', 0), (2, 'D', -10), (3, 'U', -20), (5, 'U', -18), (6, 'D', -8), (7, 'U', -22)]:
                if st <= pos < st + ln:
                    vs = V if way == 'D' else list(reversed(V))
                    for k, p in enumerate(vs):
                        n(p, pos * E + k * 12, E + 40, v + dv - k * 3)
        elif style == 'strum6':
            for pos, way, dv in [(0, 'D', 0), (2, 'U', -18), (3, 'D', -6), (5, 'U', -20)]:
                if st <= pos < st + ln:
                    vs = V if way == 'D' else list(reversed(V))
                    for k, p in enumerate(vs):
                        n(p, pos * E + k * 14, E + 60, v + dv - k * 3)
        elif style == 'arp':
            tones = [p + 12 for p in V]
            cyc = tones + list(reversed(tones))[1:-1]
            for k in range(ln):
                n(cyc[k % len(cyc)], (st + k) * E, E, v)
        elif style == 'arp16':
            tones = [p + 12 for p in V] + [V[0] + 24]
            for k in range(ln * 2):
                n(tones[k % len(tones)], (st * E) + k * (E // 2), E // 2 - 10, v - (0 if k % 4 == 0 else 12))
        elif style == 'block':
            for k in range(st, st + ln, 4):
                for p in V:
                    n(p, k * E, min(4, st + ln - k) * E - 20)
        elif style == 'stab':
            for k in (0, 3, 6):
                if st <= k < st + ln:
                    for p in V:
                        n(p, k * E, E - 40)
        elif style == 'waltz':
            for k in range(st, st + ln):
                if k % 2 == 0 and k % self.bl != 0:
                    for p in V:
                        n(p, k * E, E + 40)
        elif style == 'picking':
            low = V[0] - 12
            seq = [low, V[1], V[2], V[-1] + 0, V[1] + 12, V[2], V[-1], V[1]]
            for k in range(ln):
                n(seq[(st + k) % 8] if k else low, (st + k) * E, E * 2, v - (0 if k == 0 else 10))
        elif style == 'charleston':
            hits = [st] if ln <= 4 else [st, st + 3]
            for h in hits:
                for p in V:
                    n(p, h * E, TPQ // 2)

    def _bass(self, b, ch, b0, st, ln, chords, nxt):
        style, tr, v = b
        r = ch.bass
        add = lambda p, pos, l, vv=v: self.note(tr, p, b0 + (st + pos) * E, b0 + (st + pos + l) * E - 30, vv)
        if style == 'oompah':
            for k in range(0, ln, 4):
                add(r if (k // 4) % 2 == 0 else r + 7, k, 2)
        elif style == 'pop':
            pat = [(0, r), (3, r + 12), (4, r + 7), (6, r)] if ln == 8 else [(0, r), (2, r + 7)]
            for pos, p in pat:
                if pos < ln:
                    add(p, pos, 1, v if pos == 0 else v - 12)
        elif style in ('eighths', 'octaves'):
            for k in range(ln):
                add(r + (12 if style == 'octaves' and k % 2 else 0), k, 1, v - (0 if k % 2 == 0 else 10))
        elif style == 'edm':
            for k in range(ln):
                if k % 2 == 1:
                    add(r, k, 1)
            add(r - 12 if r >= 40 else r, 0, 1, v - 10)
        elif style == 'latin':
            pat = [(0, r, 3), (3, r + 7, 1), (4, r, 2), (6, r + 7, 2)] if ln == 8 else [(0, r, 3), (3, r + 7, 1)]
            for pos, p, l in pat:
                add(p, pos, l)
        elif style == 'root':
            for k in range(0, ln, 4):
                add(r, k, min(4, ln - k))
        elif style == 'whole':
            add(r, 0, ln)
        elif style == 'waltz':
            add(r, 0, 2)
        elif style == 'shanty':
            add(r, 0, 2)
            if ln >= 6:
                add(r + 7, 3, 2, v - 8)
        elif style == 'quarters':
            for k in range(0, ln, 2):
                add(r if (k // 2) % 2 == 0 else r + 7, k, 1)
        elif style == 'walk':
            target = nxt.bass
            line = [r, r + ch.third, r + 7, target - 1 if target - 1 > r else target + 1]
            if ln == 4:
                line = [r, target + 1 if target < r else target - 1]
            for k in range(ln // 2):
                add(line[k], k * 2, 2, v if k == 0 else v - 10)

    def _counter(self, c, ch, b0, st, ln):
        style, tr, v = c
        tones = [p + 24 for p in ch.voicing]
        if style == 'sparkle':
            for k in range(ln):
                if (st + k) % 2 == 1:
                    self.note(tr, tones[k // 2 % len(tones)], b0 + (st + k) * E, b0 + (st + k + 1) * E, v)
        elif style == 'chime':
            for k in range(0, ln, 4):
                self.note(tr, tones[-1], b0 + (st + k) * E, b0 + (st + k + 2) * E, v)
        elif style == 'arp':
            self._comp(('arp', tr, v), ch, b0, st, ln)

    def _drums(self, style, b0, i, crash, fill):
        K, SN, RIM, CLAP, HH, OH, RIDE, CR, TAMB, SHK, TRI = 36, 38, 37, 39, 42, 46, 51, 49, 54, 70, 81
        CONG_H, CONG_L, BONGO, WB_H, WB_L, TOM_H, TOM_M, TOM_L = 63, 64, 60, 76, 77, 50, 47, 43
        d = lambda p, pos, v: self.note('Drums', p, b0 + pos, b0 + pos + 60, v)
        e = lambda k: k * E
        bl = self.bl
        if crash:
            d(CR, 0, 96)
        if style == 'light':
            for k in range(8):
                d(SHK, e(k), 62 if k % 2 else 48)
            d(K, 0, 76); d(K, e(4), 70); d(RIM, e(6), 66)
        elif style == 'pop':
            for k in range(8):
                d(HH, e(k), 66 if k % 2 == 0 else 52)
            for k in (0, 3, 4):
                d(K, e(k), 92 if k != 3 else 70)
            d(SN, e(2), 86); d(SN, e(6), 90)
        elif style == 'rock':
            for k in range(8):
                d(HH, e(k), 78 if k % 2 == 0 else 60)
            for k in (0, 4, 5):
                d(K, e(k), 100 if k != 5 else 80)
            d(SN, e(2), 100); d(SN, e(6), 104)
        elif style == 'train':
            for k in range(16):           # 刷子十六分音符：火車「卡噠卡噠」
                acc = k % 4 == 0 or k % 4 == 3
                d(SN, k * (E // 2), 72 if acc else 40)
            d(K, 0, 90); d(K, e(4), 86)
            d(HH, e(2), 50); d(HH, e(6), 50)
        elif style == 'edm':
            for k in range(4):
                d(K, k * TPQ, 104)
            d(CLAP, e(2), 92); d(CLAP, e(6), 96)
            for k in range(8):
                d(OH if k % 2 else HH, e(k), 66 if k % 2 else 50)
        elif style == 'latin':
            clave = [0, 3, 6] if i % 2 == 0 else [2, 4]
            for k in clave:
                d(75, e(k), 76)
            for k in range(8):
                d(SHK, e(k), 60 if k % 2 else 46)
            for k, p in [(0, CONG_L), (2, CONG_H), (3, CONG_H), (5, CONG_L), (6, CONG_H), (7, CONG_H)]:
                d(p, e(k), 70)
            d(K, 0, 80); d(K, e(4), 72)
        elif style == 'waltz':
            d(K, 0, 64)
            d(TAMB, e(2), 56); d(TAMB, e(4), 56)
            for k in range(bl):
                d(83, e(k), 50 if k % 2 else 64)    # 雪橇鈴（GS 鼓組 83 = Jingle Bell）
            if i % 4 == 0:
                d(TRI, 0, 70)
        elif style == 'shanty':
            d(K, 0, 84); d(K, e(3), 70)
            d(TAMB, e(3), 66)
            for k in range(bl):
                d(SHK, e(k), 52 if k % 3 else 64)
        elif style == 'brush':
            for q in range(4):
                d(RIDE, q * TPQ, 66)
            d(RIM, e(6), 64); d(K, 0, 56); d(K, e(4), 50)
        elif style == 'comic':
            d(K, 0, 80); d(K, e(4), 74)
            d(SN, e(2), 62); d(SN, e(6), 66)
            for k in range(8):
                if k % 2:
                    d(WB_H if (k // 2) % 2 else WB_L, e(k), 66)
        elif style == 'march':
            for k in range(8):
                d(SN, e(k), 84 if k % 2 == 0 else 58)
            d(K, 0, 104); d(K, e(4), 100)
            d(CR if i % 4 == 0 else RIDE, 0, 80)
            d(CLAP, e(2), 76); d(CLAP, e(6), 80)
        if fill:
            if bl == 8:
                for k, p in enumerate([SN, SN, TOM_H, TOM_H, TOM_M, TOM_M, TOM_L, TOM_L]):
                    d(p, e(6) + k * (E // 4), 74 + k * 4)
            else:
                for k, p in enumerate([SN, TOM_H, TOM_M, TOM_L]):
                    d(p, e(bl - 2) + k * (E // 2), 70 + k * 6)

    def seconds(self):
        return self.bar_no * self.bl / 2 * 60 / self.bpm

    def save(self, path):
        total = self.bar_no * self.bl * E
        mid = mido.MidiFile(ticks_per_beat=TPQ)
        cond = mido.MidiTrack()
        cond.append(mido.MetaMessage('track_name', name=self.title, time=0))
        cond.append(mido.MetaMessage('set_tempo', tempo=mido.bpm2tempo(self.bpm), time=0))
        cond.append(mido.MetaMessage('time_signature', numerator=self.timesig[0],
                                     denominator=self.timesig[1], time=0))
        cond.append(mido.MetaMessage('key_signature', key=self.key, time=0))
        cond.append(mido.MetaMessage('end_of_track', time=total))
        mid.tracks.append(cond)
        for name, (ch, prog, ev) in self.tracks.items():
            t = mido.MidiTrack()
            t.append(mido.MetaMessage('track_name', name=name, time=0))
            if ch != 9:
                t.append(mido.Message('program_change', channel=ch, program=prog, time=0))
            ev.sort(key=lambda x: (x[0], 0 if x[1] == 'note_off' else 1))
            now = 0
            for tick, kind, p, v in ev:
                t.append(mido.Message(kind, channel=ch, note=p, velocity=v, time=tick - now))
                now = tick
            t.append(mido.MetaMessage('end_of_track', time=max(0, total - now)))
            mid.tracks.append(t)
        mid.save(path)


def render(song, stem, workdir):
    """MIDI → fluidsynth → 裁成循環長度、響度對齊 → 192k MP3。回傳 (mp3 路徑, 秒數, 平均 dB, 峰值 dB)。"""
    mid = MUSIC_DIR / f'{stem}.mid'
    mp3 = MUSIC_DIR / f'{stem}_背景合成.mp3'
    wav = Path(workdir) / f'{stem}.wav'
    song.save(mid)
    subprocess.run(['fluidsynth', '-ni', '-g', '0.6', '-r', '44100', '-F', str(wav), str(SOUNDFONT), str(mid)],
                   check=True, capture_output=True)
    length = f'{song.seconds():.3f}'

    def stats(path, extra=()):
        out = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(path), *extra, '-af', 'volumedetect',
                              '-f', 'null', '-'], capture_output=True, text=True).stderr
        mean = float(re.search(r'mean_volume: (-?[\d.]+)', out).group(1))
        peak = float(re.search(r'max_volume: (-?[\d.]+)', out).group(1))
        return mean, peak

    mean, _ = stats(wav, ['-t', length])
    gain = TARGET_MEAN_DB - mean
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav), '-t', length,
                    '-af', f'volume={gain:.1f}dB', '-codec:a', 'libmp3lame', '-b:a', '192k', str(mp3)], check=True)
    mean2, peak2 = stats(mp3)
    return mp3, song.seconds(), mean2, peak2
