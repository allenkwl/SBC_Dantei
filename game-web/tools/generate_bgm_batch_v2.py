"""BGM 全面升級第二批：四季、三種列車行進曲、船運、飛機、負債、總決算，一次產生 MIDI 與試聽 MP3。

用法：python3 generate_bgm_batch_v2.py [曲名...]（不給曲名就全部做）
輸出到 音樂.音效/<中文名>_v2.mid 與 <中文名>_v2_背景合成.mp3；不會動遊戲的 assets/audio。
"""
import sys
import tempfile
from bgm_lib import Song, render, parse_melody, transpose


def with_last(melody, *bars):
    """把旋律最後幾小節換掉（A' 段常用）。"""
    parts = melody.split('|')
    return '|'.join(parts[:len(parts) - len(bars)] + list(bars))


# ───────────── 春天：D 大調、清新、鳥鳴 ─────────────
def spring():
    s = Song('Spring BGM v2', 116, key='D')
    for args in [('Flute', 0, 73), ('Violin', 1, 40), ('Piccolo', 2, 72), ('Guitar', 3, 25),
                 ('Pizzicato', 4, 45), ('Strings', 5, 48), ('Bass', 6, 33), ('Drums', 9, 0)]:
        s.track(*args)
    A = ('F#5 A5 D6:2 C#6 B5 A5:2 | B5 A5 F#5:2 D5:4 | G5 A5 B5:2 D6:2 B5:2 | A5:3 G5 F#5:2 E5:2 |'
         'F#5 A5 D6:2 E6 D6 C#6:2 | C#6:2 A5:2 B5:2 F#5:2 | G5:2 E5:2 C#5:2 E5:2 | D5:6 r:2')
    HA = 'D | Bm | G | A | D | F#m Bm | Em7 A7 | D'
    B = ('B5:2 D6:2 G6:4 | F#6 E6 C#6:2 A5:4 | A5 C#6 F#6:2 E6:2 C#6:2 | D6:4 B5:2 F#5:2 |'
         'G5 B5 D6:2 E6 D6 B5:2 | C#6:2 E6:2 A6:4 | G6:2 E6:2 B5:2 G5:2 | A5:2 C#6:2 E6:2 G6:2')
    HB = 'G | A | F#m | Bm | G | A | Em7 | A7'
    strum, pizz, bass = ('strum', 'Guitar', 72), ('offbeat', 'Pizzicato', 58), ('pop', 'Bass', 88)
    s.section('D | A7', 'A5 F#5 A5 r D6 r:3 | C#6 A5 E5 r:5', 'Piccolo', 72, comp=strum, bass=bass, drums='light')
    s.section(HA, A, 'Flute', 94, comp=strum, comp2=pizz, bass=bass, drums='light', fill=True)
    s.section(HB, B, 'Violin', 90, comp=strum, pad=('Strings', 52, 0), bass=bass, drums='pop',
              counter=('sparkle', 'Piccolo', 44), crash=True, fill=True)
    s.section(HA, with_last(A, 'D5:2 F#5:2 A5:2 D6:2'), 'Flute', 96, double=('Piccolo', 12, 50),
              comp=strum, comp2=pizz, pad=('Strings', 48, 0), bass=bass, drums='pop', crash=True)
    s.section('D Bm | Em7 A7', 'F#6:4 D6:4 | E6:2 B5:2 C#6:2 E6:2', 'Flute', 90, comp=strum, bass=bass,
              drums='light', fill=True)
    return s, '春天_v2'


# ───────────── 夏天：A 大調、海灘卡利騷 ─────────────
def summer():
    s = Song('Summer BGM v2', 124, key='A')
    for args in [('Steel Drum', 0, 114), ('Marimba', 1, 12), ('Guitar', 2, 24), ('Bass', 3, 33),
                 ('Brass', 4, 61), ('Drums', 9, 0)]:
        s.track(*args)
    A = ('E5 C#5 E5 A5:2 G#5 A5:2 | F#5 A5 F#5 D5:2 E5 F#5:2 | G#5 B5 G#5 E5:2 F#5 G#5:2 | A5:3 E5 C#5:4 |'
         'E5 C#5 E5 A5:2 B5 C#6:2 | D6 C#6 B5 A5:2 F#5 A5:2 | B5:2 A5 G#5 E5:2 G#5:2 | A5:6 r:2')
    HA = 'A | D | E | A | A | D | Bm7 E7 | A'
    B = ('A5:2 D6:2 F#6:2 D6:2 | E6:3 D6 B5:4 | C#6 E6 G#5:2 C#6:2 E6:2 | F#6:4 C#6:4 |'
         'D6 C#6 B5 A5 F#5:2 A5:2 | B5 C#6 D6 E6 G#6:2 E6:2 | D6:2 B5:2 F#5:2 A5:2 | G#5:2 B5:2 D6:2 E6:2')
    HB = 'D | E | C#m | F#m | D | E | Bm7 | E7'
    strum, mar, bass = ('strum', 'Guitar', 74), ('offbeat', 'Marimba', 62), ('latin', 'Bass', 92)
    s.section('A | E7', 'A5 E5 C#5 E5 A5:2 r:2 | G#5 E5 B4 E5 G#5:2 r:2', 'Marimba', 80, comp=strum,
              bass=bass, drums='latin')
    s.section(HA, A, 'Steel Drum', 100, comp=strum, comp2=mar, bass=bass, drums='latin', fill=True)
    s.section(HB, B, 'Steel Drum', 102, comp=strum, comp2=('stab', 'Brass', 62), bass=bass, drums='latin',
              crash=True, fill=True)
    s.section(HA, with_last(A, 'A5:2 C#6:2 E6:2 A5:2'), 'Steel Drum', 104, double=('Marimba', -12, 60),
              comp=strum, comp2=mar, bass=bass, drums='latin', crash=True)
    s.section('A F#m | Bm7 E7', 'C#6:4 A5:4 | B5:2 D6:2 G#5:2 B5:2', 'Steel Drum', 96, comp=strum,
              bass=bass, drums='latin', fill=True)
    return s, '夏天_v2'


# ───────────── 秋天：F 大調、溫暖的木吉他分解和弦 ─────────────
def autumn():
    s = Song('Autumn BGM v2', 96, key='F')
    for args in [('Oboe', 0, 68), ('Horn', 1, 60), ('Guitar', 2, 25), ('Strings', 3, 48),
                 ('Bass', 4, 32), ('Glockenspiel', 5, 9), ('Drums', 9, 0)]:
        s.track(*args)
    A = ('A4:2 C5:2 F5:3 E5 | D5:2 F5:2 A5:4 | G5 F5 D5:2 Bb4:2 D5:2 | C5:6 r:2 |'
         'E5:2 G5:2 C6:3 Bb5 | A5:2 F5:2 D5:4 | Bb4:2 D5:2 G5:2 E5:2 | F5:6 r:2')
    HA = 'Fmaj7 | Dm7 | Bbmaj7 | C | Am7 | Dm7 | Gm7 C7 | Fmaj7'
    B = ('D5:2 F5:2 Bb5:4 | A5 G5 E5:2 C5:4 | C5:2 E5:2 A5:2 G5:2 | F5:6 E5:2 |'
         'D5:2 F5:2 A5:3 G5 | G5:2 E5:2 C5:4 | Bb4:2 D5:2 F5:2 A5:2 | G5:4 E5:2 C5:2')
    HB = 'Bbmaj7 | C | Am7 | Dm7 | Bbmaj7 | C | Gm7 | C7'
    pick, bass = ('picking', 'Guitar', 70), ('root', 'Bass', 84)
    s.section('Fmaj7 | Bbmaj7', None, comp=pick, bass=bass)
    s.section(HA, A, 'Oboe', 90, comp=pick, bass=bass, drums='brush')
    s.section(HB, B, 'Horn', 86, comp=pick, pad=('Strings', 50, 0), bass=bass, drums='brush',
              counter=('chime', 'Glockenspiel', 46))
    s.section(HA, with_last(A, 'F5:2 A5:2 C6:4'), 'Oboe', 92, comp=pick, pad=('Strings', 46, 0),
              bass=bass, drums='brush')
    s.section('F Dm | Gm7 C7', 'A5:4 F5:4 | G5:2 Bb5:2 E5:2 C5:2', 'Oboe', 86, comp=pick, bass=bass, drums='brush')
    return s, '秋天_v2'


# ───────────── 冬天：降 B 大調圓舞曲、音樂盒與雪橇鈴 ─────────────
def winter():
    s = Song('Winter BGM v2', 156, bar=6, timesig=(3, 4), key='Bb')
    for args in [('Music Box', 0, 10), ('Strings Lead', 1, 48), ('Harp', 2, 46), ('Glockenspiel', 3, 9),
                 ('Pad', 4, 89), ('Bass', 5, 32), ('Drums', 9, 0)]:
        s.track(*args)
    A = ('D5:4 F5:2 | Bb5:6 | A5:2 Bb5:2 G5:2 | D5:6 | Eb5:4 G5:2 | C6:4 Bb5:2 | A5:2 Bb5:2 D5:2 | C5:6 |'
         'D5:4 F5:2 | F#5:2 A5:2 C6:2 | Bb5:4 G5:2 | D5:6 | G5:2 Bb5:2 Eb6:2 | D6:4 C6:2 | Bb5:6 | r:6')
    HA = 'Bb | Bb | Gm | Gm | Eb | F | Bb | F7 | Bb | D7 | Gm | Gm | Eb | F7 | Bb | Bb'
    B = ('G5:4 Bb5:2 | Eb6:6 | D6:2 C6:2 Bb5:2 | F5:6 | Eb5:4 G5:2 | A5:4 C6:2 | Bb5:2 D6:2 F6:2 | D6:6 |'
         'G5:4 Bb5:2 | Gb5:4 Bb5:2 | F5:2 D5:2 F5:2 | B5:6 | C6:4 Eb6:2 | D6:2 C6:2 A5:2 | Bb5:6 | A5:2 C6:2 Eb6:2')
    HB = 'Eb | Eb | Bb | Bb | Cm | F7 | Bb | Bb | Eb | Ebm | Bb | G7 | Cm | F7 | Bb | F7'
    harp, bass = ('waltz', 'Harp', 64), ('waltz', 'Bass', 84)
    s.section('Bb | Gm | Eb | F7', None, comp=('arp', 'Harp', 60), bass=bass, drums='waltz')
    s.section(HA, A, 'Music Box', 100, comp=harp, bass=bass, drums='waltz', pad=('Pad', 40, 0))
    s.section(HB, B, 'Strings Lead', 84, double=('Music Box', 12, 52), comp=harp, bass=bass, drums='waltz',
              counter=('sparkle', 'Glockenspiel', 44), pad=('Pad', 44, 0))
    s.section('Bb | Gm | Cm7 | F7', 'D6:6 | Bb5:6 | G5:4 Eb5:2 | F5:2 A5:2 C6:2', 'Music Box', 96,
              comp=harp, bass=bass, drums='waltz')
    return s, '冬天_v2'


# ───────────── 區間快車：G 大調、鄉村小火車 ─────────────
def train_local():
    s = Song('Local Express BGM v2', 138, key='G')
    for args in [('Harmonica', 0, 22), ('Fiddle', 1, 110), ('Banjo', 2, 105), ('Guitar', 3, 25),
                 ('Bass', 4, 32), ('Drums', 9, 0)]:
        s.track(*args)
    A = ('B4 D5 G5:2 G5 A5 B5:2 | A5 G5 E5 D5 B4:4 | C5 E5 G5:2 A5:2 G5:2 | D5:6 r:2 |'
         'B4 D5 G5:2 B5:2 D6:2 | E6:2 D6 B5 G5:4 | A5 B5 C#6:2 E6:2 C#6:2 | D6:4 C6:2 A5:2')
    HA = 'G | G | C | G | G | Em | A7 | D7'
    B = ('E5:2 G5:2 C6:4 | B5:2 G5:2 D5:4 | E5 F#5 G5:2 A5:2 C6:2 | B5:6 r:2 |'
         'G5:2 B5:2 E6:4 | C6:2 A5:2 E5:4 | F#5:2 A5:2 D6:2 F#6:2 | E6:2 D6:2 C6:2 A5:2')
    HB = 'C | G | C | G | Em | Am | D | D7'
    banjo, gtr, bass = ('strum', 'Banjo', 70), ('offbeat', 'Guitar', 56), ('oompah', 'Bass', 92)
    s.section('G | D7', 'G5:3 E5 G5:4 | F#5:3 D5 A5:4', 'Harmonica', 92, comp=banjo, bass=bass, drums='train')
    s.section(HA, A, 'Harmonica', 96, comp=banjo, comp2=gtr, bass=bass, drums='train', fill=True)
    s.section(HB, B, 'Fiddle', 94, comp=banjo, comp2=gtr, bass=bass, drums='train', crash=True, fill=True)
    s.section('G | G | C | G | G | Em | D7 | G',
              with_last(A, 'A5:2 F#5:2 A5:2 C6:2', 'B5:4 G5:4'), 'Harmonica', 98, double=('Fiddle', -12, 64),
              comp=banjo, comp2=gtr, bass=bass, drums='train', crash=True)
    s.section('G E7 | A7 D7', 'B5:4 G#5:4 | A5:2 C#6:2 C6:2 A5:2', 'Harmonica', 92, comp=banjo, bass=bass,
              drums='train', fill=True)
    return s, '區間快車_v2'


# ───────────── 普悠瑪：D 大調、明亮流行搖滾 ─────────────
def train_puyuma():
    s = Song('Puyuma BGM v2', 150, key='D')
    for args in [('Lead Guitar', 0, 30), ('Synth Brass', 1, 62), ('Rhythm Guitar', 2, 27), ('E.Piano', 3, 4),
                 ('Strings', 4, 48), ('Bass', 5, 33), ('Drums', 9, 0)]:
        s.track(*args)
    A = ('A5:2 F#5 A5 D6:2 A5:2 | C#6:2 B5 A5 E5:4 | D6:2 C#6 B5 F#5:2 B5:2 | G5:6 r:2 |'
         'A5:2 F#5 A5 D6:2 E6:2 | F#6:2 E6 C#6 A5:4 | B5:2 D6:2 G6:2 F#6:2 | E6:6 r:2')
    HA = 'D | A | Bm | G | D | A | G | A'
    B = ('F#5:2 B5:2 D6:4 | D6 C#6 B5:2 G5:4 | F#5:2 A5:2 D6:2 F#6:2 | E6:6 C#6:2 |'
         'D6:2 B5:2 F#5:4 | G5:2 B5:2 D6:4 | E6:2 G6:2 E6:2 B5:2 | C#6:2 E6:2 A6:4')
    HB = 'Bm | G | D | A | Bm | G | Em | A'
    stab, ep, bass = ('stab', 'Rhythm Guitar', 70), ('offbeat', 'E.Piano', 54), ('octaves', 'Bass', 90)
    s.section('D | A', None, comp=stab, bass=bass, drums='rock', fill=True)
    s.section(HA, A, 'Lead Guitar', 84, comp=stab, comp2=ep, bass=bass, drums='rock', crash=True, fill=True)
    s.section(HB, B, 'Synth Brass', 92, comp=stab, pad=('Strings', 56, 12), bass=bass, drums='rock',
              crash=True, fill=True)
    s.section('D | A | Bm | G | D | A | G A | D',
              with_last(A, 'B5:2 D6:2 C#6:2 E6:2', 'D6:6 r:2'), 'Lead Guitar', 86, double=('Synth Brass', 0, 70),
              comp=stab, comp2=ep, bass=bass, drums='rock', crash=True)
    s.section('Bm G | Em A', 'F#6:4 D6:4 | E6:2 B5:2 C#6:2 E6:2', 'Synth Brass', 90, comp=stab, bass=bass,
              drums='rock', fill=True)
    return s, '普悠瑪_v2'


# ───────────── 高鐵：E 小調電子舞曲、俐落高速 ─────────────
def train_hsr():
    s = Song('HSR BGM v2', 140, key='Em')
    for args in [('Saw Lead', 0, 81), ('Square Arp', 1, 80), ('Warm Pad', 2, 89), ('Synth Bass', 3, 38),
                 ('Bell', 4, 98), ('Drums', 9, 0)]:
        s.track(*args)
    A = ('E5 G5 B5:2 E6:2 B5:2 | C6:2 B5 G5 E5:4 | D5 G5 B5:2 D6:2 B5:2 | A5:6 F#5:2 |'
         'E5 G5 B5:2 E6:2 F#6:2 | G6:2 F#6 E6 C6:4 | B5:2 D6:2 G6:2 F#6:2 | F#6:4 D6:2 A5:2')
    HA = 'Em | C | G | D | Em | C | G | D'
    B = ('E6:4 G6:4 | F#6:4 A5:4 | B5:2 E6:2 G6:2 B6:2 | B6:6 r:2 |'
         'G6:2 E6:2 C6:4 | A5:2 D6:2 F#6:4 | D#6:2 F#6:2 A6:2 F#6:2 | B5:6 D#6:2')
    HB = 'C | D | Em | Em | C | D | B7 | B7'
    arp, bass, pad = ('arp16', 'Square Arp', 58), ('edm', 'Synth Bass', 96), ('Warm Pad', 50, 0)
    s.section('Em | C', None, comp=arp, bass=bass, drums='edm', fill=True)
    s.section(HA, A, 'Saw Lead', 88, comp=arp, bass=bass, pad=pad, drums='edm', crash=True, fill=True)
    s.section(HB, B, 'Saw Lead', 92, comp=arp, bass=bass, pad=pad, drums='edm', counter=('chime', 'Bell', 56),
              crash=True, fill=True)
    s.section('Em | C | G | D | C | D | Em | Em',
              with_last(A, 'E6:2 G6:2 C6:4', 'D6:2 F#6:2 A6:4', 'G6:4 E6:4', 'E6:6 r:2'), 'Saw Lead', 92,
              double=('Bell', 0, 50), comp=arp, bass=bass, pad=pad, drums='edm', crash=True)
    s.section('C | D', None, comp=arp, bass=bass, pad=pad, drums='edm', fill=True)
    return s, '高鐵_v2'


# ───────────── 船運航線：F 大調 6/8 水手歌 ─────────────
def sea():
    s = Song('Sea Route BGM v2', 120, bar=6, timesig=(6, 8), key='F')
    for args in [('Accordion', 0, 21), ('Whistle', 1, 78), ('Guitar', 2, 25), ('Strings', 3, 48),
                 ('Bass', 4, 32), ('Drums', 9, 0)]:
        s.track(*args)
    A = ('C5:2 F5 A5:2 F5 | Bb5:3 D6:2 Bb5 | A5:2 F5 C5:3 | G5:2 E5 C5:3 |'
         'C5:2 F5 A5:2 C6 | D6:3 Bb5:2 G5 | G5:2 A5 Bb5:2 E5 | F5:6')
    HA = 'F | Bb | F | C | F | Bb | C7 | F'
    B = ('A5:2 D6 F6:3 | D6:2 Bb5 F5:3 | A5:2 C6 F6:2 C6 | E6:3 C6:3 |'
         'D6:2 A5 F5:2 A5 | Bb5:2 D6 F6:3 | G6:2 F6 D6:2 Bb5 | C6:3 E6:3')
    HB = 'Dm | Bb | F | C | Dm | Bb | Gm | C7'
    gtr, bass = ('strum6', 'Guitar', 70), ('shanty', 'Bass', 88)
    s.section('F | C7', None, comp=gtr, bass=bass, drums='shanty')
    s.section(HA, A, 'Accordion', 92, comp=gtr, bass=bass, drums='shanty')
    s.section(HB, B, 'Whistle', 88, comp=gtr, pad=('Strings', 50, 0), bass=bass, drums='shanty', fill=True)
    s.section(HA, A, 'Accordion', 96, double=('Whistle', 12, 50), comp=gtr, pad=('Strings', 44, 0),
              bass=bass, drums='shanty')
    s.section('F | C7', 'A5:3 F5:3 | G5:2 E5 C5:3', 'Accordion', 90, comp=gtr, bass=bass, drums='shanty', fill=True)
    return s, '船運航線_v2'


# ───────────── 飛機航線：C 大調（Lydian 色彩）、翱翔 ─────────────
def plane():
    s = Song('Air Route BGM v2', 112, key='C')
    for args in [('Horn', 0, 60), ('Strings Lead', 1, 48), ('Harp', 2, 46), ('Warm Pad', 3, 89),
                 ('Strings', 4, 49), ('Bass', 5, 33), ('Timpani', 6, 47), ('Glockenspiel', 7, 9), ('Drums', 9, 0)]:
        s.track(*args)
    A = ('G4:2 C5:2 E5:2 G5:2 | F#5:4 E5:2 D5:2 | E5:2 A5:2 C6:4 | A5:6 G5:2 |'
         'G5:2 C6:2 E6:2 D6:2 | F#5:4 A5:2 D6:2 | C6:4 A5:2 F5:2 | G5:6 r:2')
    HA = 'C | D/C | Am | F | C | D/C | F | G'
    B = ('A5:4 C6:4 | B5:4 D6:4 | E6:2 D6:2 B5:4 | C6:6 A5:2 |'
         'F5:2 A5:2 C6:2 F6:2 | E6:4 D6:4 | C6:2 D6:2 F6:4 | G6:4 D6:4')
    HB = 'F | G | Em | Am | F | G | Dm7 | Gsus4 G'
    harp, bass, pad = ('arp', 'Harp', 58), ('root', 'Bass', 84), ('Warm Pad', 48, 0)
    s.section('C | D/C', None, comp=harp, bass=bass, pad=pad, counter=('chime', 'Glockenspiel', 50))
    s.section(HA, A, 'Horn', 92, comp=harp, bass=bass, pad=pad, drums='light')
    s.section(HB, B, 'Strings Lead', 88, comp=harp, comp2=('block', 'Strings', 48), bass=bass, pad=pad,
              drums='pop', counter=('chime', 'Glockenspiel', 50), crash=True, timp=True)
    s.section('C | D/C | Am | F | Dm7 | G | C | C',
              with_last(A, 'F5:2 A5:2 C6:2 D6:2', 'B5:4 D6:4', 'E6:6 D6:2', 'C6:6 r:2'), 'Horn', 96,
              double=('Strings Lead', 12, 70), comp=harp, bass=bass, pad=pad, drums='pop', crash=True)
    s.section('F | G', 'A5:8 | B5:4 D6:4', 'Strings Lead', 84, comp=harp, bass=bass, pad=pad, drums='light',
              timp=True)
    return s, '飛機航線_v2'


# ───────────── 變賣資產（負債）：D 小調、慌張但滑稽 ─────────────
def debt():
    s = Song('Debt BGM v2', 132, key='Dm')
    for args in [('Bassoon', 0, 70), ('Muted Trumpet', 1, 59), ('Xylophone', 2, 13), ('Pizzicato', 3, 45),
                 ('Tuba', 4, 58), ('Drums', 9, 0)]:
        s.track(*args)
    A = ('D4 r F4 r A4 G#4 A4:2 | C#4 r E4 r G4 F4 E4:2 | D4 E4 F4 G4 A4 Bb4 A4:2 | G4 F4 E4 D4 C#4:4 |'
         'G4 r Bb4 r D5 C#5 D5:2 | A4 r F4 r D4:4 | E4 G#4 B4 D5 C5 B4 G#4:2 | A4:2 r:2 A3:2 r:2')
    HA = 'Dm | A7 | Dm | A7 | Gm | Dm | E7 | A7'
    B = ('D5:2 F5:2 Bb5:3 A5 | A5:2 G5 F5 E5:4 | G5:2 Bb5:2 D6:3 C#6 | D6:2 A5:2 F5:4 |'
         'F5 G5 A5 Bb5 D6:2 Bb5:2 | C#6:2 E6:2 A5:4 | Bb5:2 G5:2 E5:2 G5:2 | A5:2 C#5:2 E5:2 G5:2')
    HB = 'Bb | A7 | Gm | Dm | Bb | A7 | Gm6 | A7'
    pizz, tuba = ('offbeat', 'Pizzicato', 70), ('oompah', 'Tuba', 92)
    s.section('Dm | A7', 'D5 C#5 C5 B4 Bb4 A4 G#4 A4 | r:8', 'Xylophone', 84, comp=pizz, bass=tuba, drums='comic')
    s.section(HA, A, 'Bassoon', 100, comp=pizz, bass=tuba, drums='comic', staccato=True,
              counter=('sparkle', 'Xylophone', 40), fill=True)
    s.section(HB, B, 'Muted Trumpet', 94, comp=pizz, bass=tuba, drums='comic', fill=True)
    s.section('Dm Gm | E7 A7', 'F5:4 D5:4 | G#4:2 B4:2 C#5:2 E5:2', 'Muted Trumpet', 90, double=('Bassoon', -12, 80),
              comp=pizz, bass=tuba, drums='comic', fill=True)
    return s, '變賣資產_v2'


# ───────────── 總決算慶祝：降 B 大調 → 轉 C 大調的大富翁凱旋 ─────────────
def finale():
    s = Song('Finale BGM v2', 140, key='Bb')
    for args in [('Trumpet', 0, 56), ('Brass', 1, 61), ('Horn', 2, 60), ('Strings', 3, 48),
                 ('Glockenspiel', 4, 9), ('Piano', 5, 0), ('Bass', 6, 33), ('Timpani', 7, 47), ('Drums', 9, 0)]:
        s.track(*args)
    A = ('F4 Bb4 D5 F5:3 D5 F5 | G5:2 F5 D5 Bb4:4 | Eb5 G5 Bb5:2 Bb5 C6 Bb5:2 | A5:6 r:2 |'
         'F4 Bb4 D5 F5:3 G5 A5 | Bb5:2 A5 G5 D5:4 | Eb5:2 G5:2 C6:2 A5:2 | Bb5:6 r:2')
    HA = 'Bb | Gm | Eb | F | Bb | Gm | Cm7 F7 | Bb'
    B = ('G5:2 Bb5:2 Eb6:4 | C6:2 A5:2 F5:4 | F5:2 A5:2 D6:3 C6 | Bb5:6 r:2 |'
         'G5 A5 Bb5:2 Eb6:2 G6:2 | F6:4 C6:2 A5:2 | Eb6:2 C6:2 G5:2 Bb5:2 | B5:2 D6:2 F6:2 G6:2')
    HB = 'Eb | F | Dm | Gm | Eb | F | Cm7 | G7'
    piano, bass = ('offbeat', 'Piano', 70), ('octaves', 'Bass', 96)
    brass = ('stab', 'Brass', 84)
    s.section('Bb | F7', 'F5 F5 F5 Bb5:5 | A5 A5 A5 C6:3 r:2', 'Trumpet', 104, comp=('block', 'Brass', 90),
              bass=('root', 'Bass', 96), drums='march', crash=True, timp=True)
    s.section(HA, A, 'Trumpet', 104, comp=piano, comp2=brass, bass=bass, pad=('Strings', 60, 0),
              drums='march', crash=True, fill=True)
    s.section(HA, A, 'Brass', 104, double=('Trumpet', 12, 80), comp=piano, comp2=('stab', 'Horn', 76),
              bass=bass, pad=('Strings', 66, 12), counter=('sparkle', 'Glockenspiel', 54), drums='march',
              crash=True, fill=True)
    s.section(HB, B, 'Horn', 100, double=('Strings', 12, 84), comp=piano, comp2=brass, bass=bass,
              drums='march', crash=True, timp=True)
    a_up = transpose(parse_melody(with_last(A, 'Bb5:6 r:2'), 8), 2)   # 全段升全音：C 大調大爆發
    s.section('C | Am | F | G | C | Am | Dm7 G7 | C', a_up, 'Brass', 112, double=('Trumpet', 12, 92),
              comp=piano, comp2=('stab', 'Horn', 86), bass=bass, pad=('Strings', 72, 12),
              counter=('sparkle', 'Glockenspiel', 60), drums='march', crash=True, fill=True)
    s.section('C Ab | Bb F7', 'E6:4 Eb6:4 | D6:4 C6:2 A5:2', 'Trumpet', 108, comp=('block', 'Brass', 94),
              bass=bass, drums='march', crash=True, timp=True)
    return s, '總決算慶祝_v2'


SONGS = {f.__name__: f for f in [spring, summer, autumn, winter, train_local, train_puyuma, train_hsr,
                                 sea, plane, debt, finale]}

if __name__ == '__main__':
    names = sys.argv[1:] or list(SONGS)
    with tempfile.TemporaryDirectory() as tmp:
        for n in names:
            song, stem = SONGS[n]()
            mp3, secs, mean, peak = render(song, stem, tmp)
            print(f'{n:14s} {stem:12s} {song.bar_no:3d} 小節 {secs:5.1f} 秒  平均 {mean:5.1f} dB  峰值 {peak:5.1f} dB')
