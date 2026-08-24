"""Generate the original MIDI celebration theme for the final ranking ceremony.

The 32-bar cue follows the animation's arc: arrival fanfare, playful ranking
reveals, a short suspense build, then a crowded winner celebration with
whistles, applause and firework-like bursts.  It uses General MIDI only so the
score remains editable and portable between DAWs and hardware synths.
"""
from pathlib import Path
import struct

TPQ = 480
BAR = TPQ * 4
BPM = 132
OUT = Path(__file__).resolve().parents[1] / "assets" / "audio" / "finale_celebration_v0.1.mid"


def vlq(value):
    data = [value & 0x7F]
    while value > 0x7F:
        value >>= 7
        data.append((value & 0x7F) | 0x80)
    return bytes(reversed(data))


def midi_track(events):
    events.sort(key=lambda item: (item[0], item[2] if len(item) > 2 else 1))
    body, previous = bytearray(), 0
    for event in events:
        tick, msg = event[0], event[1]
        body += vlq(tick - previous) + bytes(msg)
        previous = tick
    body += b"\x00\xFF\x2F\x00"
    return b"MTrk" + struct.pack(">I", len(body)) + body


def note(events, channel, pitch, start, length, velocity=90):
    events.append((start, [0x90 | channel, pitch, velocity], 1))
    events.append((start + max(1, length), [0x80 | channel, pitch, 0], 0))


def chord(events, channel, pitches, start, length, velocity):
    for pitch in pitches:
        note(events, channel, pitch, start, length, velocity)


def program(events, channel, number):
    events.append((0, [0xC0 | channel, number], 1))


def control(events, channel, number, value):
    events.append((0, [0xB0 | channel, number, value], 1))


def track_name(name):
    raw = name.encode("utf-8")
    return (0, [0xFF, 0x03, *vlq(len(raw)), *raw], 1)


# Eb major: warm, bright and naturally suited to a brass-band finale.
PROGRESSION = [
    (51, [63, 67, 70]),  # Eb
    (46, [62, 65, 70]),  # Bb
    (48, [60, 63, 67]),  # Cm
    (44, [60, 63, 68]),  # Ab
    (41, [60, 65, 68]),  # Fm
    (46, [62, 65, 70]),  # Bb
    (51, [63, 67, 70]),  # Eb
    (46, [62, 65, 70]),  # Bb turnaround
]

# Eight-bar singable hook. Tuples are pitch, beat offset, beat length.
HOOK = [
    [(75, 0, 1), (79, 1, 1), (82, 2, 2)],
    [(82, 0, 0.5), (84, 0.5, 0.5), (86, 1, 1), (84, 2, 1), (82, 3, 1)],
    [(79, 0, 1), (75, 1, 1), (79, 2, 1), (82, 3, 1)],
    [(84, 0, 2), (82, 2, 1), (79, 3, 1)],
    [(80, 0, 1), (84, 1, 1), (87, 2, 1), (84, 3, 1)],
    [(82, 0, 0.5), (84, 0.5, 0.5), (86, 1, 1), (89, 2, 2)],
    [(87, 0, 1), (86, 1, 1), (84, 2, 1), (82, 3, 1)],
    [(79, 0, 0.5), (82, 0.5, 0.5), (75, 1, 3)],
]


def setup_track(events, name, channel=None, patch=None, volume=100, pan=64):
    events.append(track_name(name))
    if channel is not None and patch is not None:
        program(events, channel, patch)
        control(events, channel, 7, volume)
        control(events, channel, 10, pan)


def add_firework(whistle, fx, drums, tick, high=96):
    # Quick upward whistle, then a layered burst and sparkling debris.
    for i, pitch in enumerate(range(high - 12, high + 1, 2)):
        note(whistle, 5, pitch, tick + i * 55, 105, 72 + i * 5)
    burst = tick + 390
    note(fx, 7, 60, burst, 180, 112)
    note(drums, 9, 49, burst, 360, 118)  # crash
    note(drums, 9, 55, burst + 45, 300, 105)  # splash
    for i, pitch in enumerate((81, 83, 79, 84, 82, 80)):
        note(whistle, 5, pitch, burst + 110 + i * 65, 90, 56 - i * 3)


def build():
    micros = round(60_000_000 / BPM)
    conductor = [
        track_name("Finale Celebration - Conductor"),
        (0, [0xFF, 0x51, 0x03, (micros >> 16) & 0xFF, (micros >> 8) & 0xFF, micros & 0xFF], 1),
        (0, [0xFF, 0x58, 0x04, 4, 2, 24, 8], 1),
        (0, [0xFF, 0x59, 0x02, 0xFD, 0x00], 1),  # Eb major
    ]
    trumpet, brass, strings, xylo, bass, whistle, applause, fx, drums = ([] for _ in range(9))
    setup_track(trumpet, "Victory Trumpet", 0, 56, 112, 76)
    setup_track(brass, "Festival Brass", 1, 61, 102, 50)
    setup_track(strings, "Celebration Strings", 2, 48, 84, 45)
    setup_track(xylo, "Playful Xylophone", 3, 13, 94, 82)
    setup_track(bass, "Parade Bass", 4, 33, 101, 64)
    setup_track(whistle, "Crowd Whistles and Firework Risers", 5, 78, 96, 70)
    setup_track(applause, "Crowd Applause", 6, 125, 92, 64)
    setup_track(fx, "Firework Bursts", 7, 126, 94, 64)
    drums.append(track_name("Festival Drums"))

    # Harmony, bass and the buoyant festival groove.
    for bar in range(32):
        start = bar * BAR
        root, harmony = PROGRESSION[bar % 8]
        energy = 58 if bar < 4 else 68 if bar < 20 else 76 if bar >= 24 else 52
        chord(strings, 2, harmony, start, BAR - 20, energy)
        if bar >= 12:
            chord(brass, 1, harmony, start, TPQ * 3 // 4, 72 if bar < 24 else 94)
            chord(brass, 1, harmony, start + TPQ * 2, TPQ * 3 // 4, 68 if bar < 24 else 88)
        # Root/fifth walking bass.
        for beat, pitch in enumerate((root, root + 7, root + 12, root + 7)):
            note(bass, 4, pitch, start + beat * TPQ, TPQ * 3 // 4, 74 + (12 if bar >= 24 else 0))
        # Kick/snare parade rhythm and constant eighth-note hats.
        for beat in range(4):
            note(drums, 9, 36 if beat in (0, 2) else 38, start + beat * TPQ, 100, 88 + (12 if bar >= 24 else 0))
        for eighth in range(8):
            note(drums, 9, 42, start + eighth * TPQ // 2, 70, 48 if eighth % 2 else 61)
        if bar % 4 == 0:
            note(drums, 9, 49, start, TPQ, 78 if bar < 24 else 112)
        # Xylophone confetti: arpeggiated chord tones off the beat.
        tones = [harmony[0] + 12, harmony[1] + 12, harmony[2] + 12, harmony[1] + 12]
        for beat, pitch in enumerate(tones):
            note(xylo, 3, pitch, start + beat * TPQ + TPQ // 2, TPQ // 3, 60 if bar < 4 else 76)

    # Opening station-style fanfare.
    intro = [(75, 0, 1), (79, 1, 1), (82, 2, 2), (84, 4, 1), (82, 5, 1), (79, 6, 1), (87, 7, 1)]
    for pitch, beat, length in intro:
        note(trumpet, 0, pitch, beat * TPQ, length * TPQ - 18, 102)
    chord(trumpet, 0, [75, 79, 82], BAR * 2, BAR, 94)
    chord(trumpet, 0, [79, 82, 87], BAR * 3, BAR, 105)

    # Ranking-reveal hook, first lightly then as a full parade reprise.
    for phrase_start, octave, velocity in ((4, -12, 83), (12, 0, 104), (24, 0, 114)):
        for bar_offset, phrase in enumerate(HOOK):
            start = (phrase_start + bar_offset) * BAR
            for pitch, beat, length in phrase:
                target = xylo if phrase_start == 4 else trumpet
                channel = 3 if phrase_start == 4 else 0
                note(target, channel, pitch + octave, start + round(beat * TPQ), round(length * TPQ) - 18, velocity)

    # Bars 20-23: drum roll and rising suspense before the champion appears.
    for bar in range(20, 24):
        start = bar * BAR
        subdivisions = 8 if bar < 22 else 16
        for i in range(subdivisions):
            note(drums, 9, 38, start + i * BAR // subdivisions, 70, 48 + (bar - 20) * 16 + i)
        for i in range(4):
            note(whistle, 5, 79 + (bar - 20) * 3 + i, start + i * TPQ, TPQ // 2, 55 + i * 7)
    chord(brass, 1, [63, 67, 70, 75], BAR * 24, BAR, 118)

    # Winner party: continuous applause, whistles, and four offset fireworks.
    for bar in range(24, 32):
        start = bar * BAR
        for pitch in (55, 60, 67):
            note(applause, 6, pitch, start, BAR - 20, 68 + (bar % 3) * 9)
        if bar in (25, 27, 29, 31):
            note(whistle, 5, 91 + (bar % 4), start + TPQ // 2, TPQ, 103)
    for bar, offset, high in ((24, 0, 96), (26, 2, 101), (28, 1, 98), (30, 2, 103)):
        add_firework(whistle, fx, drums, bar * BAR + offset * TPQ, high)

    # Big clean final hit at the end of bar 31.
    final = BAR * 31 + TPQ * 3
    chord(trumpet, 0, [75, 79, 82, 87], final, TPQ, 120)
    chord(brass, 1, [51, 55, 58, 63], final, TPQ, 118)
    note(drums, 9, 49, final, TPQ, 124)

    tracks = [conductor, trumpet, brass, strings, xylo, bass, whistle, applause, fx, drums]
    chunks = [midi_track(events) for events in tracks]
    header = b"MThd" + struct.pack(">IHHH", 6, 1, len(chunks), TPQ)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(header + b"".join(chunks))
    print(OUT)


if __name__ == "__main__":
    build()
