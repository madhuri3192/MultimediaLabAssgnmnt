# Multimedia Sample Dataset

This directory contains a compact but varied dataset for the metadata experiments and the Python cluster scripts. It has 25 primary media files and is approximately 10 MiB.

## Images

| File | Format | Useful metadata |
| --- | --- | --- |
| `camera_canon_40d.jpg` | JPEG | Canon EOS 40D, capture date, exposure data, GPS IFD |
| `camera_canon_s40.jpg` | JPEG | Canon PowerShot S40, capture date and camera settings |
| `camera_nikon_d70.jpg` | JPEG | Nikon D70, capture date and exposure data |
| `camera_pentax_k10d.jpg` | JPEG | Pentax K10D, capture date and camera settings |
| `camera_samsung_digimax.jpg` | JPEG | Samsung Digimax model and capture date |
| `camera_reconyx_trail.jpg` | JPEG | Large 2048 × 1536 trail-camera sample |
| `gps_dscn0010.jpg` | JPEG | Nikon COOLPIX P6000 with GPS coordinates |
| `gps_dscn0025.jpg` | JPEG | Nikon COOLPIX P6000 with different GPS coordinates |
| `gps_dscn0042.jpg` | JPEG | Nikon COOLPIX P6000 with different GPS coordinates |
| `sample_bsg1.tiff` | TIFF | 635 × 348 image with 15 top-level EXIF fields |
| `sample_dudley.tiff` | TIFF | 196 × 257 image with 18 top-level EXIF fields |
| `sample_iphone.heic` | HEIC | HEIC container with multiple HEVC image items |

The image files were downloaded from the [ianare/exif-samples](https://github.com/ianare/exif-samples) test corpus. Its JPEG documentation says most samples originated on Wikimedia Commons and points to the original description pages for individual attribution. The repository states that contributed samples are released under CC BY-SA 4.0. Keep this README with redistributed copies.

The HEIC file is useful for testing parser-versus-decoder limitations. The current Pillow installation cannot decode it without an additional HEIF plugin, while browser metadata parsers may still inspect its container.

## Audio

| File | Codec | Expected properties |
| --- | --- | --- |
| `mono_22k_8bit.wav` | PCM unsigned 8-bit | Mono, 22.05 kHz, 4 seconds |
| `mono_44k_16bit.wav` | PCM signed 16-bit | Mono, 44.1 kHz, 5 seconds |
| `stereo_48k_24bit.wav` | PCM signed 24-bit | Stereo, 48 kHz, 6 seconds |
| `tagged_128k.mp3` | MP3 | Stereo, 44.1 kHz, 128 kbps, title/artist/album/genre/date/track tags |
| `tagged_96k.flac` | FLAC | Stereo, 96 kHz, lossless, descriptive tags |
| `tagged_vorbis.ogg` | Vorbis | Stereo, 48 kHz, descriptive stream tags |
| `tagged_aac.m4a` | AAC in MP4 | Stereo, 48 kHz, 192 kbps, title/artist/album/genre tags |

All seven audio files work with `Cluster03-Audio-Processing/audio_metadata.py` and the consolidated `main.py`. Compressed formats require FFprobe. The processing exercise accepts the 16-bit WAV sample; convert the stereo 24-bit sample to a separate 16-bit WAV to demonstrate stereo-to-mono (see the root README).

## Video

| File | Container and streams | Expected properties |
| --- | --- | --- |
| `h264_aac_720p.mp4` | MP4, H.264 + AAC | 1280 × 720, 30 FPS, 6 seconds, title/comment tags |
| `hevc_aac_720p.mp4` | MP4, HEVC + AAC | 1280 × 720, 25 FPS, 4 seconds |
| `vp9_opus_480p.webm` | WebM, VP9 + Opus | 854 × 480, 24 FPS, 5 seconds |
| `mpeg4_mp3_legacy.avi` | AVI, MPEG-4 + MP3 | 640 × 480, 25 FPS, legacy-container test |
| `portrait_video_only.mp4` | MP4, H.264 | 360 × 640, no audio stream, 5 seconds |
| `multistream_h264.mkv` | MKV, H.264 + 2 AAC + SRT | English/Hindi audio language tags and one subtitle stream |

Audio and video samples were generated with FFmpeg from synthetic tones, noise, and test patterns. They contain no third-party music or footage.

## Running the Python examples

```powershell
python Cluster02-Image-Processing/image_metadata.py datasets/images/gps_dscn0010.jpg
python Cluster03-Audio-Processing/audio_metadata.py datasets/audio/stereo_48k_24bit.wav
python Cluster04-Video-Processing/video_metadata.py datasets/video/multistream_h264.mkv
```

Image extraction requires Pillow. Video and compressed-audio extraction require `ffprobe` from FFmpeg. PCM WAV extraction uses Python's standard-library `wave` module, with optional tags from FFprobe. Install the shared Python dependencies from the root `requirements.txt`.

See the [project README](../README.md) for the consolidated analyzer, processing
commands and supported-format limitations.
