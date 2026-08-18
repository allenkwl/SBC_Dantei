"""Generate the original looping MIDI theme for the online lobby.

The 16-bar score is intentionally self-contained: it uses only General MIDI
programs, resolves on the same D-minor sonority it begins with, and finishes
without a tail so a browser's native Audio.loop can repeat it cleanly.
"""
from pathlib import Path
import struct

TPQ = 480
BAR = TPQ * 4
OUT = Path(__file__).resolve().parents[1] / 'assets' / 'audio' / 'lobby.mid'


def vlq(value):
    data = [value & 0x7F]
    while value > 0x7F:
        value >>= 7
        data.append((value & 0x7F) | 0x80)
    return bytes(reversed(data))


def track(events):
    """events are (absolute_tick, message_bytes); turn them into an MTrk."""
    events.sort(key=lambda item: (item[0], 0 if item[1][0] & 0xF0 == 0x80 else 1))
    body, previous = bytearray(), 0
    for tick, msg in events:
        body += vlq(tick - previous) + bytes(msg)
        previous = tick
    body += b'\x00\xFF\x2F\x00'
    return b'MTrk' + struct.pack('>I', len(body)) + body


def note(events, channel, pitch, start, length, velocity=90):
    events.append((start, [0x90 | channel, pitch, velocity]))
    events.append((start + length, [0x80 | channel, pitch, 0]))


def program(events, channel, number):
    events.append((0, [0xC0 | channel, number]))


def chord(events, channel, pitches, start, length, velocity):
    for pitch in pitches:
        note(events, channel, pitch, start, length, velocity)


# Dm → Bb → F → C is the travel motif; the last four bars build into the
# lobby's "ready for adventure" fanfare and return to D minor at the loop.
HARMONY = [
    [38, 41, 45], [34, 38, 41], [33, 36, 40], [36, 40, 43],
    [38, 41, 45], [34, 38, 41], [31, 34, 38], [33, 37, 40],
    [38, 41, 45], [34, 38, 41], [33, 36, 40], [36, 40, 43],
    [31, 34, 38], [34, 38, 41], [33, 37, 40], [38, 41, 45],
]
MELODY = [
    [(74, 0, 480), (77, 480, 480), (81, 960, 960)],
    [(82, 0, 480), (81, 480, 480), (77, 960, 480), (74, 1440, 480)],
    [(72, 0, 480), (77, 480, 480), (81, 960, 480), (84, 1440, 480)],
    [(79, 0, 480), (76, 480, 480), (72, 960, 960)],
    [(74, 0, 480), (77, 480, 480), (81, 960, 480), (86, 1440, 480)],
    [(82, 0, 480), (81, 480, 480), (77, 960, 480), (74, 1440, 480)],
    [(71, 0, 480), (74, 480, 480), (79, 960, 480), (77, 1440, 480)],
    [(76, 0, 480), (81, 480, 1440)],
    [(74, 0, 480), (77, 480, 480), (81, 960, 480), (86, 1440, 480)],
    [(89, 0, 480), (86, 480, 480), (82, 960, 480), (81, 1440, 480)],
    [(81, 0, 480), (84, 480, 480), (89, 960, 960)],
    [(88, 0, 480), (84, 480, 480), (79, 960, 480), (76, 1440, 480)],
    [(79, 0, 480), (82, 480, 480), (86, 960, 480), (89, 1440, 480)],
    [(91, 0, 960), (89, 960, 480), (86, 1440, 480)],
    [(85, 0, 480), (88, 480, 480), (91, 960, 480), (88, 1440, 480)],
    [(86, 0, 1920)],
]


def build():
    conductor = [
        (0, [0xFF, 0x51, 0x03, 0x08, 0x2E, 0x8B]),  # 112 BPM
        (0, [0xFF, 0x58, 0x04, 4, 2, 24, 8]),
        (0, [0xFF, 0x59, 0x02, 0xFF, 0x01]),         # D minor
        (0, [0xFF, 0x03, 22, *b'Lobby Epic - Conductor']),
    ]
    horn, strings, choir, harp, bass, drums = ([] for _ in range(6))
    program(horn, 0, 60)       # French horn
    program(strings, 1, 48)    # String ensemble
    program(choir, 2, 52)      # Choir pad
    program(harp, 3, 46)       # Orchestral harp
    program(bass, 4, 43)       # Contrabass

    for bar, low in enumerate(HARMONY):
        start = bar * BAR
        # Sustained harmony gives the lobby its broad cinematic floor.
        chord(strings, 1, [p + 12 for p in low], start, BAR, 56 if bar < 8 else 66)
        chord(choir, 2, [p + 24 for p in low[1:]], start, BAR, 40)
        note(bass, 4, low[0], start, BAR - 20, 72)
        # Harp travel arpeggio: low → fifth → third → octave on each beat.
        arp = [low[0] + 12, low[2] + 12, low[1] + 12, low[0] + 24]
        for beat, pitch in enumerate(arp):
            note(harp, 3, pitch, start + beat * TPQ, TPQ // 2, 52)
        # Timpani-like pulse plus cymbal swells on phrase entrances.
        note(drums, 9, 36, start, TPQ // 2, 72)
        note(drums, 9, 43, start + TPQ * 2, TPQ // 2, 54)
        if bar in (0, 4, 8, 12):
            note(drums, 9, 49, start, TPQ, 62)
        # Add a low brass answer beneath the melody in the second half.
        if bar >= 8:
            chord(horn, 0, [low[0] + 12, low[2] + 12], start, TPQ * 2, 65)
        for pitch, offset, length in MELODY[bar]:
            note(horn, 0, pitch, start + offset, length - 18, 98 if bar >= 8 else 88)

    # Resolve a little before the end, leaving the final D-minor bed seamless.
    chord(strings, 1, [50, 53, 57, 62], BAR * 15, BAR, 76)
    chord(choir, 2, [65, 69, 74], BAR * 15, BAR, 54)
    tracks = [track(conductor), track(horn), track(strings), track(choir), track(harp), track(bass), track(drums)]
    header = b'MThd' + struct.pack('>IHHH', 6, 1, len(tracks), TPQ)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(header + b''.join(tracks))
    print(OUT)


if __name__ == '__main__':
    build()
