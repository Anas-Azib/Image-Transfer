# Image Transfer

Move an image between two devices over a purely optical link. One screen displays
a stream of machine-readable symbols; the other device's camera reads them back
and rebuilds the file.

There is no network path between the two devices — no internet, no API, no
database, no WebSocket, no Bluetooth, no Wi-Fi, no server of any kind. Vercel
serves the static bundle and nothing else. Once the page has loaded, the whole
thing works with the connection switched off.

```
Device A screen  →  visual symbols  →  Device B camera
```

---

## Running it

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run validate
```

`validate` runs type checking, linting, the full test suite and a production
build. `npm run build` emits a static `dist/` that Vercel serves directly; the
included `vercel.json` sets the SPA rewrite and asset caching.

Camera access requires a secure context, so the receiving device needs HTTPS
(or `localhost`). A Vercel deployment satisfies this automatically.

---

## Using it

1. Open **Encode** on the device with the bigger screen and pick an image.
2. Open **Decode** on the device with the camera and grant access.
3. Start the transmission, and point the camera at the symbol.
4. When every frame has arrived and the checksum verifies, the image appears
   with **Save** and **Discard**.

Hold the camera roughly square to the screen, with the whole symbol — including
its white border — inside the guides. Frames repeat continuously, so anything the
camera misses comes round again on the next pass.

---

## The VDT protocol

### Symbol

Each frame is drawn as a square grid of black and white modules.

```
┌──────────────────────────────────────┐
│  ▛▀▜                            ▛▀▜  │   ▛▀▜  7×7 finder pattern
│  ▙▄▟ ·:·:·:·:·:·:·:·:·:·:·:·:·  ▙▄▟  │   ·:·  timing pattern
│   :                              :   │   ▣    5×5 alignment pattern
│   ·        DATA MODULES          ·   │
│   :     (masked, RS-encoded)     :   │
│   ·                        ▣     ·   │
│  ▛▀▜                                 │
│  ▙▄▟                                 │
└──────────────────────────────────────┘
```

* **Three finder patterns**, not four. The missing corner is what makes
  orientation unambiguous, so the symbol reads at any rotation.
* **One alignment pattern** near the bottom-right. It supplies the fourth point
  the perspective transform needs, and it sits exactly where an affine
  approximation is worst — which is what makes off-axis captures decode.
* **Timing patterns** on row and column 6, used to validate the inferred grid.
* **Data modules** are written in a two-column serpentine so the eight bits of a
  byte land in a compact 2×4 tile, and XORed with a fixed checkerboard mask.

Three sizes are supported: 33, 41 (default) and 49 modules per side. 49 is the
largest useful size — its data region already exceeds what a single GF(256)
Reed–Solomon codeword can hold, so a denser grid would buy no payload, only
smaller modules.

### Frame

Every frame is fully self-describing, so the decoder can join a transmission
already in progress and place any capture correctly regardless of arrival order.

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 1 | magic (`0xC5`) |
| 1 | 1 | protocol version |
| 2 | 4 | transfer ID |
| 6 | 2 | frame index |
| 8 | 2 | total frames |
| 10 | 2 | payload length |
| 12 | 4 | CRC-32 over the header above plus the payload |
| 16 | … | payload |

The packet is padded to the Reed–Solomon message length, then encoded into a
codeword whose parity section is 14%, 24% or 36% of the symbol depending on the
chosen error-correction level. Reed–Solomon repairs damage; the CRC is the
independent judge of whether the repair actually produced the original bytes.

### Stream

The byte stream is `manifest ‖ file`, chunked across frames. Putting the manifest
*inside* the stream means it is checksummed and retransmitted by exactly the same
machinery as the payload — there is no special first frame whose loss would
strand the receiver.

The manifest carries the file's length, CRC-32, pixel dimensions, MIME type and
name.

### Reliability

The camera is an unreliable, unordered channel. The protocol assumes it:

* **Missed frames** — the transmitter loops continuously; a frame the camera
  misses simply comes round again. Retransmission *is* the redundancy mechanism.
* **Duplicates** — a 30 fps camera reading a 10 fps display sees each frame
  around three times. Repeats land in a filled slot and are counted, not stored.
* **Out-of-order arrival** — every frame is placed by the index in its own
  header, never by arrival order.
* **Corruption** — Reed–Solomon repairs up to half the parity length in byte
  errors; anything the CRC still rejects is discarded rather than shown.
* **Two transmitters** — frames are keyed by a random 32-bit transfer ID. A
  single stray frame from another transfer is ignored; a sustained run switches.

---

## Decoding pipeline

Ordered cheapest-first, so a camera frame containing no symbol is rejected before
it reaches Reed–Solomon.

1. Downscale to the analysis resolution and threshold with a block-adaptive
   ("hybrid") binarizer that tracks glare and vignetting across the frame.
2. Scan rows for the 1:1:3:1:1 finder run signature; confirm each candidate
   vertically and diagonally.
3. Pick and orient a triple of finders — the corner opposite the longest side is
   the top-left, and a cross product resolves the other two.
4. Estimate the module count from the finder spacing.
5. Extrapolate the missing corner, template-match the alignment pattern near
   where it should be, and fit a projective transform.
6. Resample each module by majority vote over several points.
7. Score the function patterns, then Reed–Solomon decode and check the CRC.

Both the affine and the alignment-refined transforms are scored, and the better
one wins: a rotated but head-on capture is already perfectly described by the
affine fit, and there a spurious alignment match would actively make things
worse.

---

## Measured behaviour

Numbers below come from the test suite, which renders symbols to pixels and
photographs them through a simulated camera (perspective, defocus, sensor noise,
glare, mirroring) before running the real detector.

**Throughput** at 100 ms per frame:

| Symbol | Payload/frame | Rate |
| --- | --- | --- |
| 33 (Compact) | 62 B | ~0.6 kB/s |
| 41 (Standard) | 118 B | ~1.2 kB/s |
| 49 (Dense) | 177 B | ~1.8 kB/s |

This is slow, and it is why the encoder recompresses by default: a stock phone
photo sent untouched would take the better part of an hour. At the Balanced
preset a typical picture lands around 20–60 kB, or roughly 20–50 seconds.

**Detection envelope** — 87 of 93 synthetic capture scenarios decode. The
failures are all at viewing angles beyond roughly 45°, where the far edge of the
symbol genuinely loses more than half its resolution. That is an optical limit,
not a decoder defect.

**Per-frame yield** is 100% in good conditions and around 90% handheld and
off-axis. The remaining loss is content-dependent — whether a given symbol
survives depends on its own module pattern — which is precisely what the
retransmission loop absorbs.

### Known limitations

* Viewing angles steeper than about 45° do not decode reliably.
* Analysis runs at 640 px on the longest edge. This is deliberate and measured:
  a higher-resolution pass decodes *worse*, because the adaptive threshold needs
  a module to span roughly 4–8 px and the downscale also averages away sensor
  noise before it can flip a module.
* A single Reed–Solomon block per symbol caps a frame at 255 bytes. Interleaved
  blocks would lift that, at a reliability cost that is not worth paying at these
  module sizes.
* There is no back-channel, so the transmitter cannot know which frames to
  resend. It cycles through all of them instead.

---

## Architecture

No backend, no API routes, no server-side anything. The separation is between
protocol, device I/O and interface.

```
src/
├─ app/                     shell, routes (/, /encode, /decode), error boundary
├─ components/
│  ├─ common/               Button, Alert, ProgressBar, StatGrid, SegmentedControl
│  ├─ encode/               picker, image summary, settings
│  ├─ decode/               camera viewport, reception panel, result
│  └─ transfer/             the transmission stage
├─ features/
│  ├─ encoder/              transfer plan, frame generation, the rAF frame loop
│  ├─ decoder/              scan loop, frame accumulation and assembly
│  ├─ camera/               getUserMedia, error mapping, stream teardown
│  └─ image/                file reading, recompression, reconstruction, saving
├─ hooks/                   useEncoder, useDecoder, useCamera, motion helpers
├─ lib/
│  ├─ vdt/                  the protocol: constants, layout, RS, CRC, render
│  │  └─ detect/            binarize, finder, alignment, perspective, sampler
│  └─ utils/                formatting
└─ styles/                  tokens and base styles
```

Two boundaries are load-bearing:

**The frame loop never enters React.** `FrameTransmitter` owns a canvas and
paints from a `requestAnimationFrame` loop scheduled against absolute deadlines.
It reports to React through a status callback throttled to 5 Hz, so a slow render
cannot skew the 100 ms cadence. `setInterval` is avoided deliberately: it drifts,
it keeps firing while the tab is hidden, and it can queue callbacks faster than
they are serviced. After a stall the loop resynchronises rather than replaying a
backlog of frames no camera could resolve.

**Detection is pure.** Everything under `lib/vdt/` operates on plain pixel
buffers with no DOM dependency, which is what lets the test suite drive the real
decoder without a camera.

---

## Testing

```bash
npm run test
```

165 tests. The ones that matter most:

* **`opticalTransfer`** — an image goes in, is rendered to pixels, photographed
  through the simulated camera, detected, reassembled, and comes out byte-identical.
* **`transferRoundTrip`** — real PNG, BMP and GIF files across every symbol size
  and ECC level, plus out-of-order, dropped, duplicated and incomplete delivery.
* **`detector`** — the capture envelope: perspective, rotation, blur, noise,
  glare, mirroring, sensor resolution, and negative cases that must *not* decode.
* **`canvasRendering`** — the renderer the browser actually uses, verified
  decodable rather than just plausible.
* **`frameTransmitter`** — the 100 ms cadence, driven by a fake animation clock:
  no double-painting, no drift, resync after a stall, cleanup on destroy.
* **`architecture`** — fails the build if anything reintroduces `fetch`,
  WebSockets, a cloud SDK or a hard-coded URL.
* **`reedSolomon`** — corrects up to ⌊parity/2⌋ byte errors and rejects damage
  beyond it.
