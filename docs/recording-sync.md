# Recording Sync

How a take recorded in the browser ends up in time with the audio that is already in the project.

## What the user sees

1. Press **Record** on a track. The first time a given microphone + output pair is used, *Settings →
   Playback and Devices* opens and **Measure** runs on its own. The button stays on **Measuring…**
   until the number is saved into the recording offset field.
   - Hover **Measure** for the instruction: measure the input-to-output round trip, and make sure
     the input device can hear the output device before measuring.
   - Type a number in that same field to use your own offset. **Measure** replaces it with a new
     round trip.
   - Hover **Measure** on a wireless device for a warning that the round trip will vary and a
     wired device holds a steadier time. The offset saved from the measurement is a whole number
     of milliseconds. A typed offset is rounded to a whole number as well.
2. After a successful measurement, press **Record** again. Takes are trimmed by the offset in that
   field.

Apollo asks to measure again when the physical devices change (headset plugged in, different
microphone selected) or when the browser renegotiates the output path (sample rate or output
latency changed).

## Supported setup

- **Best:** a wired headset whose microphone and headphones are one device (USB or one 3.5 mm
  TRRS jack). Both ends share one clock, so a single measurement stays valid for the whole take.
- **Works, with a warning:** headphones on one device and a microphone on another (for example the
  built-in laptop microphone with USB headphones). The start of the take is aligned, but the two
  clocks drift slowly, so long takes can slide by a few milliseconds.
- **Less precise:** Bluetooth headphones or headsets. The round trip varies, so a measured offset
  is only a starting point and long takes can still need a manual timing adjustment. A wired
  headphone holds a steadier time.

The settings panel shows these warnings based on the selected devices.

## How it works

- **One clock.** The microphone is captured by an `AudioWorklet` running on the same `AudioContext`
  that plays the project. Every captured block is tagged with its audio-clock frame index, so a
  take is placed by sample position, not by the UI playhead.
- **Audio-clock anchors.** When Record is pressed while playing, the clock and timeline position
  are read together. When pressed while stopped, playback starts first and the take is anchored on
  the exact instant playback was scheduled. Loop wraps split the continuous capture at the instant
  the seek happened; the microphone is never restarted mid-take.
- **Measured round trip.** The calibration plays logarithmic sweeps through the same output chain
  as playback (limiter, ceiling, selected output device) and finds each one with a phase-weighted
  correlation, so a speaker or microphone that colors the tone does not hide it. The first sweep is a
  coarse fix: the browser's output-latency figure is only a hint for where to look, and the
  recording stops at the end of that window so the first sweep stays short. A wired window ends
  just after the hint; a wireless window stays open longer, because Bluetooth buffering is often
  missing from the figure. A miss searches the whole range. The tone itself is a short log sweep:
  the bandwidth makes the peak sharp, and a close microphone does not need a long tone. Later sweeps
  search a window around that fix. Each sweep is logged in the browser console, and the first line
  is the browser's `outputLatency`. The **Measure** button stays in a loading state until the run
  finishes, then the offset field takes that delay.
  A fully wired microphone and output can stop once three sweeps sit inside about 1 ms and that
  cluster is most of the run. The stored delay is their median, so one sweep that locks onto an
  echo does not move it. A slow drift that only settles at the end is not treated as a tight fit. If either end
  is wireless, or the browser hides the device names, the run starts with seven sweeps. If that bar
  is missed, the sweeps are fitted to a normal curve. The stored delay is the mean of the curve. The
  result also stores the standard deviation and the standard error of the mean. A wider curve keeps
  the test running until that error is about 2 ms, up to 24 sweeps. A standard deviation above about
  80 ms is still rejected, and a setup the microphone never hears is rejected instead of scored as a
  random delay. The result is stored
  per `${inputDeviceId}|${outputDeviceId}` in
  `localStorage` (`apollo.settings.recordingCalibrations`) together with the sample rate and
  `outputLatency` used to detect staleness.
- **Trim at extraction.** The stored clip is placed from the record point to the stop point, matching
  the on-screen indicator and the playhead. Its samples start one round trip into the capture and
  include the round trip after stop, which is the sound the performer played against what they heard.
  The clip contains what the performer played against what they heard, with no crop offset to
  manage afterwards.

## Expected precision

Within one browser session on a wired device, repeated takes agree with the project to roughly:

- Firefox / Safari (desktop): ~1 ms
- Chrome on macOS: ~1–2 ms
- Chrome / Edge on Windows: ~3–6 ms
- Chrome on Linux: ~8 ms

A Bluetooth output can still be measured. The saved offset is one whole number of milliseconds, and
the delay can move again on the next take. A native full-duplex audio engine would be needed to get
below the wired figures above.

## Relevant code

- `src/lib/recordingManager.js` — worklet capture, segments by audio-clock frame
- `src/lib/recordingLatencyCalibration.js` — log sweeps and phase-weighted correlation
- `src/utils/recordingDevices.js` — device identity, calibration keys, staleness, offset resolution
- `src/components/SettingsPanels.jsx` — recording offset field and Measure button
- `src/components/Editor.jsx` — record / stop / loop-wrap flows
