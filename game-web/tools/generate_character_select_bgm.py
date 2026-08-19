"""Write the original looping MIDI cue for the player-cat selection screen."""
from pathlib import Path
import struct

TPQ, BAR = 480, 1920
OUT = Path(__file__).resolve().parents[1] / 'assets' / 'audio' / 'character_select.mid'


def vlq(value):
    parts = [value & 0x7F]
    while value > 0x7F:
        value >>= 7
        parts.append((value & 0x7F) | 0x80)
    return bytes(reversed(parts))


def mtrk(events):
    events.sort(key=lambda event: (event[0], 0 if event[1][0] & 0xF0 == 0x80 else 1))
    data, last = bytearray(), 0
    for tick, message in events:
        data += vlq(tick - last) + bytes(message)
        last = tick
    data += b'\x00\xFF\x2F\x00'
    return b'MTrk' + struct.pack('>I', len(data)) + data


def add_note(events, channel, pitch, at, duration, velocity):
    events.extend(((at, [0x90 | channel, pitch, velocity]), (at + duration, [0x80 | channel, pitch, 0])))


def add_chord(events, channel, notes, at, duration, velocity):
    for pitch in notes:
        add_note(events, channel, pitch, at, duration, velocity)


def program(events, channel, patch):
    events.append((0, [0xC0 | channel, patch]))


# C / G / Am / F, with a last-bar C return: the ending and beginning share
# the same harmony, so the browser can loop it without changing the mood.
CHORDS = [
    [48, 52, 55], [43, 47, 50], [45, 48, 52], [41, 45, 48],
    [48, 52, 55], [43, 47, 50], [45, 48, 52], [43, 47, 50],
    [48, 52, 55], [41, 45, 48], [45, 48, 52], [43, 47, 50],
    [48, 52, 55], [43, 47, 50], [41, 45, 48], [48, 52, 55],
]
MELODY = [
    [72, 76, 79, 76, 74, 76, 72, 67], [71, 74, 79, 74, 71, 74, 79, 81],
    [76, 81, 84, 81, 79, 76, 72, 76], [69, 72, 77, 72, 69, 72, 74, 76],
    [79, 81, 84, 81, 79, 76, 72, 76], [74, 71, 74, 79, 81, 79, 74, 71],
    [72, 76, 81, 84, 81, 79, 76, 72], [71, 74, 79, 83, 81, 79, 74, 71],
    [84, 83, 81, 79, 76, 79, 81, 84], [81, 79, 77, 76, 72, 76, 79, 81],
    [84, 81, 79, 76, 81, 79, 76, 72], [74, 79, 83, 86, 83, 81, 79, 74],
    [72, 76, 79, 84, 79, 76, 72, 76], [74, 79, 83, 86, 83, 79, 74, 71],
    [69, 72, 77, 81, 84, 81, 77, 72], [72, 76, 79, 84, 79, 76, 72, 67],
]


def build():
    conductor = [
        (0, [0xFF, 0x51, 0x03, 0x06, 0x8A, 0x1B]),  # 140 BPM
        (0, [0xFF, 0x58, 0x04, 4, 2, 24, 8]),
        (0, [0xFF, 0x59, 0x02, 0, 0]),               # C major
    ]
    bell, pizz, marimba, bass, drums = ([] for _ in range(5))
    program(bell, 0, 9)       # Glockenspiel
    program(pizz, 1, 45)      # Pizzicato strings
    program(marimba, 2, 12)   # Marimba
    program(bass, 3, 32)      # Acoustic bass

    for bar, harmony in enumerate(CHORDS):
        start = bar * BAR
        add_chord(pizz, 1, harmony, start, BAR // 2 - 24, 49)
        add_chord(pizz, 1, harmony, start + BAR // 2, BAR // 2 - 24, 45)
        add_note(bass, 3, harmony[0] - 12, start, TPQ, 70)
        add_note(bass, 3, harmony[0] - 12, start + TPQ * 2, TPQ, 64)
        # Small marimba answering pattern keeps the cue bouncy between picks.
        for beat, pitch in enumerate((harmony[0], harmony[2], harmony[1], harmony[2])):
            add_note(marimba, 2, pitch + 12, start + beat * TPQ, TPQ // 2, 54)
        for step, pitch in enumerate(MELODY[bar]):
            add_note(bell, 0, pitch, start + step * (TPQ // 2), TPQ // 2 - 20, 86 if bar < 8 else 92)
        # Light kit: kick on 1/3, clap-like snare on 2/4, closed hat on eighths.
        for step in range(8):
            add_note(drums, 9, 42, start + step * (TPQ // 2), 72, 42)
        for beat in (0, 2):
            add_note(drums, 9, 36, start + beat * TPQ, 100, 66)
        for beat in (1, 3):
            add_note(drums, 9, 39, start + beat * TPQ, 100, 50)
        if bar in (0, 8):
            add_note(drums, 9, 54, start, TPQ, 43)

    tracks = [mtrk(conductor), mtrk(bell), mtrk(pizz), mtrk(marimba), mtrk(bass), mtrk(drums)]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(b'MThd' + struct.pack('>IHHH', 6, 1, len(tracks), TPQ) + b''.join(tracks))
    print(OUT)


if __name__ == '__main__':
    build()
