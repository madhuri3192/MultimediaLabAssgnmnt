# Test fixtures

Tiny synthetic sine-tone files generated with ffmpeg (no speech, no personal data).
They exist so the server-side duration probe is tested against real container
formats rather than mocks.

| File | Purpose |
| --- | --- |
| `tone-2s.{wav,mp3,flac,ogg,m4a}` | Each supported container parses to ~2 s |
| `tone-2s-live.webm` | WebM written in "live" mode (no `Info.Duration`), like Chrome's MediaRecorder |
| `tone-31s-live.webm` | Same, but over the 30 s limit — must be rejected via the block scanner |
| `tone-31s.mp3` | Over the limit via ordinary metadata |

Regenerate with, for example:

```sh
ffmpeg -f lavfi -i "sine=frequency=440:duration=2" -ac 1 -c:a libopus -b:a 6k -live 1 tone-2s-live.webm
```
