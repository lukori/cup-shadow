# Cup Shadow

**Live:** https://lukori.github.io/cup-shadow/ (tuning: https://lukori.github.io/cup-shadow/?debug)

A disposable cup gets a fake, living shadow on the phone screen. Point the iPhone at the cup standing on the printed coaster:

- **Normal:** two regular-looking cup shadows, right-back and left-back (as if lit by two lamps). It breathes slightly and once in a while its far end "peeks" (`life`).
- **Hand comes near the cup:** each shadow turns into a dog's head silhouette (shadow-puppet style, with an eye hole). It growls (louder the closer the hand is), ears prick up, and when the hand gets very close it barks: mouth snaps open and the head lunges forward. The second dog answers a moment later in a lower voice. Real recorded barks and growl since v3.
- **Hand goes away:** after `calmDelay` seconds the dog shrinks back into the cup's shadow.
- **Blow on the phone ("poo" into the mic):** the shadows give way to a rose opening around the cup, the cup standing as its middle (petals unfold ring by ring from the middle out, over `bloomTime` seconds), with a soft breath-and-swell sound. It stays `flowerTime` seconds, then closes. A blow beats the dog; if the hand is still near when the rose ends, the dog comes back.

Web page, no app: open it in Safari on the iPhone, tap the red button (the start screen is only an empty red button, no text, since v4), allow camera and microphone. No on-screen hints during use either. Should also work on Android Chrome (not tested).

## Files

| file | what |
|---|---|
| `print/coaster-A4.pdf` | **print this** at 100% / actual size. The square must measure 150 mm |
| `index.html` | page + start screen |
| `app.js` | tracking, hand + blow detection, behaviour, debug panel, all tunable values (`DEFAULT_PARAMS`) |
| `shadow.js` | draws the cup / dog / rose shadow shapes (the old stem flower `drawFlower` is still there, unused) |
| `sound.js` | plays the recorded sounds (synth fallback) + blow detector |
| `assets/coaster.png`, `assets/coaster.mind` | coaster image and its compiled tracking file |
| `tools/make_coaster.py` | generates the coaster + print sheet (fixed seed) |
| `sounds/` | recorded barks + growl, credits in `sounds/README.txt` |

## How it works

- **Tracking:** MindAR follows the printed coaster (not the cup: a smooth cup is too hard to track). The cup is assumed to stand in the middle of the coaster, on the dashed circle. The coaster's red arrow is its "top": place the coaster so the arrow points **away from where people stand** (the cup hides whatever is behind it).
- **Shadow:** drawn into a texture lying flat on the table around the coaster. An invisible cup-shaped object hides the part of the shadow that is behind the real cup.
- **Steady picture (v3):** the tracker's pose wobbles a little even when nothing moves. The shadow hangs on our own copy of the pose that creeps slowly toward small changes (`poseSteady`) and catches up fast with real movement (`poseFollow`). When tracking is lost for a moment (a hand passing in front) the shadow holds still for 0.35 s and then fades, instead of popping off and on.
- **Zone sensor (main trigger since v2):** spots on the table in two rings around the cup, fixed to the coaster. Each spot remembers its usual colour; a hand (or its shadow) covering spots changes them. Outer ring covered = growl, inner ring = bark. Spots hidden behind the cup are skipped. Added because on the iPhone the hand model only noticed the hand once it was already over the cup.
  - v3, after "the dogs bark at the start for no reason" (the v2 log: right after locking on, 17-58% of spots looked covered with no hand, for 16 s, until tracking re-locked): the tracker is still settling in its first second, so the spots slid over the busy print and memorised the wrong colours. Now the sensor only *learns* (never counts) during the first 1.2 s and whenever the coaster moves on screen (`zoneStill`; also catches walking around the cup), each spot is a 3x3 average instead of one pixel, the colour change is the biggest change of any colour channel (skin over the print is mostly a hue change), and a covered spot only counts if a neighbour is covered too (a hand covers neighbours, wobble flips scattered spots). A hand held still stays a hand for ~30 s.
- **Hand:** MediaPipe hand tracking (detection made more willing in v2: confidence 0.4 → 0.25). Nearness = the stronger of hand model and zone sensor. "Nearness" = how close the nearest hand point is to the cup **on screen**, measured in cup sizes (the cup's outline on screen), so it works at any phone distance. A hand that looks much bigger than the cup (`handMax`) is near the phone, not the cup, and is ignored.
- **Blow:** loud (dB) AND either noise-like (flatness) OR mostly low rumble (`blowLow`). On the iPhone a blow straight on the mic measured -10 to -18 dB, flatness ~0.00, low ~0.97, so the rumble rule is what catches it. The mic is ignored while our own bark/chime plays.

## Sounds and art

Sounds are synthesised placeholders. To use real recordings, add `sounds/bark.mp3`, `sounds/growl.mp3` (loops) and/or `sounds/bloom.mp3`; any file that exists replaces the synthesised one.

The shapes are drawn in code in `shadow.js` (dog profile points `DOG_HEAD` / `DOG_JAW`, flower in `drawFlower`). They can later be replaced by drawn images or animations.

## Tuning

Add `?debug` to the address: live numbers (fps, tracking, hand nearness, mic dB/flatness), test buttons (dog / bark / flower / calm), **guides** (green = coaster outline, orange = where the app thinks the cup is), +/- per value (the address updates, copy it to keep the tuning), Copy/Save log (Save log goes to the Files app → Downloads; Copy log is easier). In debug mode, holding a finger (or the mouse) on the screen acts as a pretend hand at that spot, to try the dog without the hand model.

| param | default | what it does |
|---|---|---|
| cupH / cupTop / cupBot | 95 / 80 / 56 mm | size of the real cup: set to the actual cup (check with guides) |
| cupX / cupY | 0 / 0 mm | where the cup really stands, if it is not exactly on the dashed circle: right / toward the red arrow. Check with **guides**: the orange outline should sit on the real cup |
| poseSteady | 4 | how fast the picture follows tiny tracking wobble (lower = calmer, but slow drift) |
| poseFollow | 30 | how fast it follows real phone movement (higher = less lag, more shake) |
| shadowDeg | 20 (right, a little behind; was -50 front-right in v1, you asked for side + slightly behind) | direction the shadow falls. 0 = toward the coaster's right edge, 90 = toward the red arrow, -90 = toward the viewer. Anything pointing to 90 (behind the cup) gets hidden by the cup. At the venue, match the real shadows in the room |
| twin | 1 | 1 = second, mirrored shadow on the left (`180 - shadowDeg`, dog looks the other way). 0 = only the right one |
| dogFace | -1 | which way the dog looks: -1 = toward the viewer, 1 = away |
| shadowLen | 0.8 (was 1.1: ran off the coaster and off screen) | shadow length / cup height (1 = light at 45°) |
| shadowDark | 0.5 | darkness |
| shadowSoft | 6 (v3, you asked for a touch more blur; was 4; v1 had 9: too blurry up close) | edge blur |
| life | 1 | idle breathing / peeking of the normal shadow (0 = still) |
| morph | 3 | speed of changing shape |
| dogSize | 1.25 | dog size relative to the normal shadow |
| roseSize | 95 mm | rose outer radius (the cup is its middle; the coaster is 75 mm from middle to edge) |
| bloomTime | 2.2 s | how long the rose takes to open |
| nearD / farD | 0.1 / 1.0 (was 0.3 / 1.8: the cup fills much of the screen, so almost any hand counted as near) | hand distance (in cup sizes on screen) that counts as fully near / not near |
| handMax | 2.4 | hand bigger than this × cup on screen is ignored (it is near the phone) |
| alertAt / barkAt / calmAt | 0.35 / 0.8 / 0.2 | nearness that wakes the dog / makes it bark / lets it calm down |
| calmDelay | 1.2 s | how long the hand must stay away before the dog turns back into a shadow |
| barkGap | 0.9 s | time between barks |
| steady | 6 | hand nearness smoothing (lower = steadier but slower) |
| handEvery | 70 ms | time between hand detections (raise if the phone gets slow/hot) |
| zoneGain | 1 | strength of the zone sensor (0 = off) |
| zoneDiff | 35 | colour change for a spot to count as covered, biggest of R/G/B (raise if it triggers by itself). In the fake test, no-hand noise was 14 (99%) / 29 (max) while shaking, the hand 40-50 |
| zoneFrac | 0.12 | share of a ring covered that counts as fully near (lower = more sensitive) |
| zoneStill | 0.025 (v3) | movement of the coaster on screen (half coaster widths per 80 ms) above which the zone sensor pauses. Still phone in the test: 0.001-0.014. If the dog never wakes from the zone on a shaky hand, raise it (the debug line shows `moved`) |
| blowDb | -24 dB | how loud a blow must be |
| blowFlat | 0.15 (was 0.3: a test blow-like noise measured 0.29; a voice-like tone measured 0.00) | how noise-like (speech is lower) |
| blowLow | 0.85 | or: share of low rumble that counts as a blow |
| blowHold | 0.15 s | how long the blow must last |
| flowerTime | 5 s | how long the rose stays |
| volume | 0.8 | sound volume |

## Not verified yet (v3)

- Everything new in v3 was tested with the fake 3D camera only (lock-on, shaking 1.5 cm, walking around the cup fast and slow: no false dog; hand next to the cup wakes it, held still it stays awake, gone: calm and no false wake afterwards). Not yet on the iPhone.
- The recorded sounds were chosen by their numbers (clean, loud, no long silence), not by ear: listen and replace any you don't like (`sounds/README.txt`).

## Not verified yet (v1)

- Everything on a real iPhone: camera tracking quality at a real angle, hand detection speed alongside tracking, mic levels (`blowDb`, `blowFlat` are guesses), sound loudness while the mic is open (iOS may play quieter when the mic is on).
- Tested on a computer with a fake 3D camera (coaster + 95 mm paper cup, seen from 50° at ~36 cm): the coaster is tracked even with the cup hiding part of it, the cup guide lines up with the cup, the shadow is hidden behind the cup correctly, dog and flower show in front-right of the cup, a pretend hand near the cup wakes the dog and it calms after the hand leaves. Blow detector numbers: blow-like noise flatness 0.29, voice-like tone 0.00.
- First load takes a while (tracking + hand models download, ~10 MB).

## Rebuilding the coaster

`python3 tools/make_coaster.py` regenerates the coaster and the print sheet. If the design changes, `assets/coaster.mind` must be rebuilt from `assets/coaster-target.png` (MindAR compiler, e.g. https://hiukim.github.io/mind-ar-js-doc/tools/compile).
