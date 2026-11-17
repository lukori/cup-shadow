# Cup Shadow

A disposable cup gets a fake, living shadow on the phone screen. Point the iPhone at the cup standing on the printed coaster:

- **Normal:** a regular-looking cup shadow on the table. It breathes slightly and once in a while its far end "peeks" (`life`).
- **Hand comes near the cup:** the shadow turns into a dog's head silhouette (shadow-puppet style, with an eye hole). It growls (louder the closer the hand is), ears prick up, and when the hand gets very close it barks: mouth snaps open and the head lunges forward.
- **Hand goes away:** after `calmDelay` seconds the dog shrinks back into the cup's shadow.
- **Blow on the phone ("poo" into the mic):** the shadow grows into a flower with a soft chime, for `flowerTime` seconds. A blow beats the dog; if the hand is still near when the flower ends, the dog comes back.

Web page, no app: open it in Safari on the iPhone, tap **התחלה**, allow camera and microphone. Should also work on Android Chrome (not tested).

## Files

| file | what |
|---|---|
| `print/coaster-A4.pdf` | **print this** at 100% / actual size. The square must measure 150 mm |
| `index.html` | page + start screen |
| `app.js` | tracking, hand + blow detection, behaviour, debug panel, all tunable values (`DEFAULT_PARAMS`) |
| `shadow.js` | draws the cup / dog / flower shadow shapes |
| `sound.js` | synthesised placeholder sounds + blow detector |
| `assets/coaster.png`, `assets/coaster.mind` | coaster image and its compiled tracking file |
| `tools/make_coaster.py` | generates the coaster + print sheet (fixed seed) |
| `sounds/` | optional real sounds, see below |

## How it works

- **Tracking:** MindAR follows the printed coaster (not the cup: a smooth cup is too hard to track). The cup is assumed to stand in the middle of the coaster, on the dashed circle. The coaster's red arrow is its "top": place the coaster so the arrow points **away from where people stand** (the cup hides whatever is behind it).
- **Shadow:** drawn into a texture lying flat on the table around the coaster. An invisible cup-shaped object hides the part of the shadow that is behind the real cup.
- **Hand:** MediaPipe hand tracking. "Nearness" = how close the nearest hand point is to the cup **on screen**, measured in cup sizes (the cup's outline on screen), so it works at any phone distance. A hand that looks much bigger than the cup (`handMax`) is near the phone, not the cup, and is ignored.
- **Blow:** the mic level (dB) plus how noise-like the sound is (spectral flatness). Blowing is loud, flat noise; speech is not flat. The mic is ignored while our own bark/chime plays.

## Sounds and art

Sounds are synthesised placeholders. To use real recordings, add `sounds/bark.mp3`, `sounds/growl.mp3` (loops) and/or `sounds/bloom.mp3`; any file that exists replaces the synthesised one.

The shapes are drawn in code in `shadow.js` (dog profile points `DOG_HEAD` / `DOG_JAW`, flower in `drawFlower`). They can later be replaced by drawn images or animations.

## Tuning

Add `?debug` to the address: live numbers (fps, tracking, hand nearness, mic dB/flatness), test buttons (dog / bark / flower / calm), **guides** (green = coaster outline, orange = where the app thinks the cup is), +/- per value (the address updates, copy it to keep the tuning), Copy/Save log. In debug mode, holding a finger (or the mouse) on the screen acts as a pretend hand at that spot, to try the dog without the hand model.

| param | default | what it does |
|---|---|---|
| cupH / cupTop / cupBot | 95 / 80 / 56 mm | size of the real cup: set to the actual cup (check with guides) |
| shadowDeg | -50 (front-right; was 25: the dog ended up behind the cup, and at -10 the flower ran off a portrait screen) | direction the shadow falls. 0 = toward the coaster's right edge, 90 = toward the red arrow, -90 = toward the viewer. Anything pointing to 90 (behind the cup) gets hidden by the cup. At the venue, match the real shadows in the room |
| dogFace | -1 | which way the dog looks: -1 = toward the viewer, 1 = away |
| shadowLen | 0.8 (was 1.1: ran off the coaster and off screen) | shadow length / cup height (1 = light at 45°) |
| shadowDark | 0.5 | darkness |
| shadowSoft | 4 (was 9: too blurry up close) | edge blur |
| life | 1 | idle breathing / peeking of the normal shadow (0 = still) |
| morph | 3 | speed of changing shape |
| dogSize / flowerSize | 1.25 / 1.4 | size relative to the normal shadow |
| nearD / farD | 0.1 / 1.0 (was 0.3 / 1.8: the cup fills much of the screen, so almost any hand counted as near) | hand distance (in cup sizes on screen) that counts as fully near / not near |
| handMax | 2.4 | hand bigger than this × cup on screen is ignored (it is near the phone) |
| alertAt / barkAt / calmAt | 0.35 / 0.8 / 0.2 | nearness that wakes the dog / makes it bark / lets it calm down |
| calmDelay | 1.2 s | how long the hand must stay away before the dog turns back into a shadow |
| barkGap | 0.9 s | time between barks |
| steady | 6 | hand nearness smoothing (lower = steadier but slower) |
| handEvery | 70 ms | time between hand detections (raise if the phone gets slow/hot) |
| blowDb | -24 dB | how loud a blow must be |
| blowFlat | 0.15 (was 0.3: a test blow-like noise measured 0.29; a voice-like tone measured 0.00) | how noise-like (speech is lower) |
| blowHold | 0.15 s | how long the blow must last |
| flowerTime | 5 s | how long the flower stays |
| volume | 0.8 | sound volume |

## Not verified yet (v1)

- Everything on a real iPhone: camera tracking quality at a real angle, hand detection speed alongside tracking, mic levels (`blowDb`, `blowFlat` are guesses), sound loudness while the mic is open (iOS may play quieter when the mic is on).
- Tested on a computer with a fake 3D camera (coaster + 95 mm paper cup, seen from 50° at ~36 cm): the coaster is tracked even with the cup hiding part of it, the cup guide lines up with the cup, the shadow is hidden behind the cup correctly, dog and flower show in front-right of the cup, a pretend hand near the cup wakes the dog and it calms after the hand leaves. Blow detector numbers: blow-like noise flatness 0.29, voice-like tone 0.00.
- First load takes a while (tracking + hand models download, ~10 MB).

## Rebuilding the coaster

`python3 tools/make_coaster.py` regenerates the coaster and the print sheet. If the design changes, `assets/coaster.mind` must be rebuilt from `assets/coaster-target.png` (MindAR compiler, e.g. https://hiukim.github.io/mind-ar-js-doc/tools/compile).
