from pathlib import Path

import mido
from mido import Message, MetaMessage, MidiFile, MidiTrack


TPB = 480
BEATS_PER_BAR = 4
BAR_TICKS = TPB * BEATS_PER_BAR
TOTAL_BARS = 30
TOTAL_TICKS = TOTAL_BARS * BAR_TICKS


def tick(bar, beat=0.0):
    return int(((bar - 1) * BEATS_PER_BAR + beat) * TPB)


def add(events, at, msg):
    events.append((at, len(events), msg))


def add_note(events, channel, note, start, duration, velocity):
    end = min(start + duration, TOTAL_TICKS)
    add(events, start, Message("note_on", channel=channel, note=note, velocity=velocity, time=0))
    add(events, end, Message("note_off", channel=channel, note=note, velocity=0, time=0))


def make_track(mid, name, events, channel=None, program=None, volume=100, pan=64):
    track = MidiTrack()
    mid.tracks.append(track)
    track.append(MetaMessage("track_name", name=name, time=0))
    if channel is not None:
        track.append(Message("control_change", channel=channel, control=7, value=volume, time=0))
        track.append(Message("control_change", channel=channel, control=10, value=pan, time=0))
        if program is not None:
            track.append(Message("program_change", channel=channel, program=program, time=0))
    last = 0
    for at, _, msg in sorted(events, key=lambda item: (item[0], item[1])):
        msg.time = at - last
        track.append(msg)
        last = at
    if last < TOTAL_TICKS:
        track.append(MetaMessage("end_of_track", time=TOTAL_TICKS - last))
    else:
        track.append(MetaMessage("end_of_track", time=0))


def chord_notes(root, quality):
    intervals = {
        "maj": (0, 4, 7),
        "min": (0, 3, 7),
        "sus": (0, 5, 7),
        "dom": (0, 4, 7, 10),
    }[quality]
    return [root + value for value in intervals]


def main():
    out = Path(__file__).with_name("小球貓電鐵宣傳片v2_60秒_BGM.mid")
    mid = MidiFile(type=1, ticks_per_beat=TPB, charset="utf-8")

    conductor = MidiTrack()
    mid.tracks.append(conductor)
    conductor.append(MetaMessage("track_name", name="Conductor", time=0))
    conductor.append(MetaMessage("set_tempo", tempo=mido.bpm2tempo(120), time=0))
    conductor.append(MetaMessage("time_signature", numerator=4, denominator=4, time=0))
    conductor.append(MetaMessage("key_signature", key="D", time=0))
    markers = [
        (1, "S01_TITLE_00s"),
        (3, "S02_CHARACTERS_04s"),
        (5, "S03_MAP_SEASONS_08s"),
        (8, "S04_DICE_TRAINS_14s"),
        (11, "S05_PROPERTIES_CARDS_20s"),
        (14, "S06_TRANSPORT_26s"),
        (18, "S07_ARRIVAL_34s"),
        (21, "S08_NEWS_SETTLEMENT_40s"),
        (24, "S09_MULTIPLAYER_46s"),
        (26, "S10_FINALE_50s"),
        (29, "END_CARD_56s"),
    ]
    last = 0
    for bar, label in markers:
        at = tick(bar)
        conductor.append(MetaMessage("marker", text=label, time=at - last))
        last = at
    conductor.append(MetaMessage("end_of_track", time=TOTAL_TICKS - last))

    # D-major-centered progression. One tuple per bar: root MIDI note and quality.
    progression = [
        (50, "maj"), (55, "maj"),
        (47, "min"), (45, "maj"),
        (43, "maj"), (50, "maj"), (45, "maj"),
        (47, "min"), (43, "maj"), (45, "maj"),
        (50, "maj"), (54, "min"), (43, "maj"),
        (52, "min"), (43, "maj"), (50, "maj"), (45, "maj"),
        (47, "min"), (43, "maj"), (45, "sus"),
        (52, "min"), (45, "maj"), (49, "maj"),
        (43, "maj"), (45, "maj"),
        (47, "min"), (43, "maj"), (45, "maj"),
        (43, "maj"), (50, "maj"),
    ]

    pad = []
    for bar, (root, quality) in enumerate(progression, 1):
        velocity = 46 if bar < 8 else 56 if bar < 26 else 70
        for note in chord_notes(root, quality):
            add_note(pad, 0, note + 12, tick(bar), BAR_TICKS, velocity)
    make_track(mid, "Warm Strings", pad, channel=0, program=48, volume=92, pan=64)

    pulse = []
    for bar, (root, quality) in enumerate(progression, 1):
        if bar <= 2:
            continue
        notes = chord_notes(root, quality)
        pattern = [0, 1, 2, 1, 0, 1, 2, 1]
        for step, degree in enumerate(pattern):
            start = tick(bar, step * 0.5)
            velocity = 45 if bar < 8 else 58 if bar < 26 else 72
            add_note(pulse, 1, notes[degree] + 24, start, int(TPB * 0.34), velocity)
    make_track(mid, "Railway Piano Pulse", pulse, channel=1, program=0, volume=90, pan=48)

    bass = []
    for bar, (root, _) in enumerate(progression, 1):
        if bar <= 2:
            add_note(bass, 2, root - 12, tick(bar), BAR_TICKS, 48)
            continue
        for beat, offset in ((0, 0), (2, 7)):
            velocity = 62 if bar < 14 else 76 if bar < 26 else 88
            add_note(bass, 2, root - 12 + offset, tick(bar, beat), TPB * 2, velocity)
    make_track(mid, "Electric Bass", bass, channel=2, program=33, volume=100, pan=64)

    # Four-bar motif, transposed and intensified according to each scene.
    motif = [74, 78, 81, 78, 76, 74, 71, 69]
    lead = []
    for bar in range(1, TOTAL_BARS + 1):
        if bar in (1, 2):
            scene_shift, velocity = 0, 64
        elif bar < 8:
            scene_shift, velocity = 0, 72
        elif bar < 14:
            scene_shift, velocity = -2, 75
        elif bar < 18:
            scene_shift, velocity = 2, 82
        elif bar < 21:
            scene_shift, velocity = 0, 86
        elif bar < 24:
            scene_shift, velocity = -2, 70
        elif bar < 26:
            scene_shift, velocity = 2, 82
        else:
            scene_shift, velocity = 12, 96
        if bar == 20:  # Leave room for the next-destination reveal at 00:38.
            add_note(lead, 3, 69, tick(bar), TPB, 58)
            continue
        for step, note in enumerate(motif):
            duration = int(TPB * (0.42 if step < 7 else 0.82))
            add_note(lead, 3, note + scene_shift, tick(bar, step * 0.5), duration, velocity)
    make_track(mid, "Adventure Lead", lead, channel=3, program=73, volume=100, pan=76)

    bells = []
    for bar in (1, 2, 3, 5, 18, 26, 29):
        root = progression[bar - 1][0]
        for beat, interval in ((0, 12), (1, 16), (2, 19)):
            add_note(bells, 4, root + interval + 12, tick(bar, beat), int(TPB * 0.7), 74 if bar < 26 else 94)
    make_track(mid, "Cat Bell Sparkle", bells, channel=4, program=9, volume=88, pan=88)

    brass = []
    for bar in list(range(14, 18)) + list(range(18, 20)) + list(range(26, 31)):
        root, quality = progression[bar - 1]
        start = tick(bar)
        duration = TPB if bar < 26 else TPB * 2
        for note in chord_notes(root, quality):
            add_note(brass, 5, note + 24, start, duration, 70 if bar < 26 else 94)
    make_track(mid, "Finale Brass", brass, channel=5, program=61, volume=96, pan=56)

    drums = []
    def drum(note, bar, beat, velocity, duration=0.12):
        add_note(drums, 9, note, tick(bar, beat), int(TPB * duration), velocity)

    for bar in range(1, TOTAL_BARS + 1):
        if bar in (1, 3, 5, 8, 11, 14, 18, 21, 24, 26, 29):
            drum(49, bar, 0, 92 if bar < 26 else 112)  # crash
        if bar <= 2:
            drum(41, bar, 0, 54)
            drum(43, bar, 2, 58)
            continue
        for beat in (0, 2):
            drum(36, bar, beat, 78 if bar < 14 else 94)
        for beat in (1, 3):
            drum(38, bar, beat, 74 if bar < 26 else 98)
        hat_step = 0.5 if bar >= 8 else 1.0
        count = int(4 / hat_step)
        for step in range(count):
            drum(42, bar, step * hat_step, 48 if step % 2 else 58)
        if bar in (17, 25, 28):
            for step, note in enumerate((45, 47, 48, 50)):
                drum(note, bar, 2 + step * 0.5, 78 + step * 7)
    make_track(mid, "Driving Drums", drums, channel=9, volume=102, pan=64)

    accents = []
    for bar in (8, 11, 14, 15, 16, 17, 18, 21, 24, 26, 28, 29):
        root = progression[bar - 1][0]
        add_note(accents, 6, root + 24, tick(bar), int(TPB * 0.35), 88 if bar < 26 else 110)
    make_track(mid, "Scene Accents", accents, channel=6, program=55, volume=92, pan=64)

    mid.save(out)
    loaded = MidiFile(out, charset="utf-8")
    print(f"wrote={out}")
    print(f"tracks={len(loaded.tracks)} duration={loaded.length:.3f}s tpb={loaded.ticks_per_beat}")


if __name__ == "__main__":
    main()
