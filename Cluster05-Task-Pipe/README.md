# Task Pipe — enhance degraded images, then read their text

Give Task Pipe a blurred, dark, noisy, inverted, rotated, skewed or photographed-at-an-angle image. It works out what is wrong, fixes it, and extracts the text. The text can be in many languages and scripts, including several in the same image.

```powershell
python Cluster05-Task-Pipe/task_pipe.py datasets/task-pipe/real/rani_kamlapati_board.jpg
```

```text
[1/1] rani_kamlapati_board.jpg  ->  outputs\task-pipe\rani_kamlapati_board
  steps: flatten_illumination (unevenness 0.79), levels_stretch (contrast 109 -> full range), gamma 0.35 (background 172 -> 225), clahe (local contrast), saturation x1.5, deskew -2.2 deg
  4 line(s), mean confidence 0.98, 5.8s
  (1.00 multi) RANI KAMALAPATI
  (1.00 multi) RAILWAY STATION
  (0.97 devanagari) रानी कमलापति
  (0.97 devanagari) रेलवे स्टेशन
```

Everything runs offline on the CPU. It uses [RapidOCR](https://github.com/RapidAI/RapidOCR), with PaddleOCR's PP-OCR models on ONNX Runtime. The first time a non-Latin script is needed, its recogniser (~8 MB) is downloaded once.

## Usage

```powershell
python -m pip install -r requirements.txt

# One image, a folder, or a glob; each image gets its own result folder
python Cluster05-Task-Pipe/task_pipe.py photo.jpg
python Cluster05-Task-Pipe/task_pipe.py scans/ --output-dir outputs/scans
python Cluster05-Task-Pipe/task_pipe.py "images/*.png" --langs en,hi
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--langs` | `auto` | Languages in the images. `auto` covers Latin-script languages, Chinese, Japanese, Hindi/Marathi/Nepali, Arabic/Urdu/Persian, Russian and other Cyrillic, and Korean. Naming the languages (`en,hi`) is faster. Also supported: `ta`, `te`, `th`, `el`, `kn`. |
| `--output-dir` | `outputs/task-pipe` | Must not exist yet; earlier results are never overwritten |
| `--min-confidence` | `0.5` | Drop lines read with lower confidence |
| `--no-rotate`, `--no-deskew`, `--no-dewarp` | off | Turn off a geometry correction |
| `--no-variants` | off | Faster: read each line once instead of picking the best rendering |
| `--quiet` | off | Print only the extracted text |
| `--open` | off | Open `results.html` (all images + text) in the browser when done |

Each image's folder contains:

| File | Content |
| --- | --- |
| `enhanced.png` | The corrected image: rotated, deskewed, dewarped, exposure/contrast/colour fixed |
| `ocr_boxes.png` | Detected lines with their confidence: green ≥ 0.85, orange ≥ 0.65, red below |
| `text.txt` | Extracted text in reading order |
| `report.json` | Steps applied, image measurements, and per-line text, confidence, recogniser and box |

The run folder also gets `summary.json`, `summary.csv` and `results.html`. The HTML page shows every image and its text, and the browser displays Hindi, Arabic and other scripts correctly even when the terminal font can't. While an image is being processed, a spinner shows the current stage and elapsed time.

From Python:

```python
from taskpipe import TaskPipe, save_outputs

pipe = TaskPipe(langs="auto")
result = pipe.process("photo.jpg")      # also accepts a numpy BGR array
print(result.text, result.mean_confidence, result.steps)
save_outputs(result, "outputs/photo")
```

## How it works

1. **Load:** applies EXIF orientation, flattens transparency onto white, normalises 16-bit and palette images, and takes the first frame of animations.
2. **Measure, then enhance only what is wrong** (`taskpipe/enhance.py`):
   - impulse noise → median filter; sensor noise → non-local-means denoise
   - shadows and uneven light → background division, with the gain capped so night skies are not turned into noise
   - under- or over-exposure → level stretch plus gamma towards a target background level
   - low contrast → CLAHE; faded colour → saturation boost; soft focus → unsharp mask
3. **Dewarp:** a page or card photographed at an angle is warped flat when a clear four-sided outline is found.
4. **Detect text lines** on both the enhanced and the original image, then merge the boxes. Enhancement can reveal faint text but can never lose a line it washed out.
5. **Orientation:**
   - Lines taller than wide mean the image is sideways, so it is turned 90°.
   - Upside-down is decided by recognising the largest lines both ways up and keeping the more confident reading.
   - Small tilts are straightened from the angle of the detected lines.
6. **Choose the script per line.** All selected recognisers read every line. A script model only counts when its reading actually contains that script; Hindi, Arabic and Korean models also read Latin text confidently. Cyrillic or Greek words that the Latin model read as look-alike letters ("apeHpa" for "аренда") go to the script model.
7. **Pick the best rendering per line.** Each line is re-read from several crops: original, enhanced, normalised grey, binarised, and with dark text on light per line, so partly inverted signs work. Agreement and confidence pick the result.
   - For blurry images, a blind Richardson-Lucy deconvolution is added. The blur kernel is chosen from Gaussian and motion-streak candidates by which one raises recognition confidence; wrong kernels lower it.
8. **Reading order:** rows from top to bottom, left to right, and right to left for Arabic.

## Accuracy

The benchmark is described in [`datasets/task-pipe`](../datasets/task-pipe/README.md): 171 synthetic degraded images in 11 languages, plus 9 real photographs. It can be reproduced with:

```powershell
python Cluster05-Task-Pipe/tools/make_benchmark.py --skip-render   # build degraded/ from clean/
python Cluster05-Task-Pipe/tools/evaluate.py --systems raw,raw_lang,taskpipe
python Cluster05-Task-Pipe/tools/evaluate.py --real --systems raw,taskpipe
```

The metric for synthetic images is **character error rate (CER)**: edit distance divided by the length of the true text, ignoring whitespace. Lower is better. `raw` is RapidOCR run directly on the image. `raw_lang` is RapidOCR given the correct script model for each image.

### Synthetic set (171 images): mean CER by degradation

| Degradation | raw | raw_lang | **Task Pipe** |
| --- | ---: | ---: | ---: |
| clean | 32.4% | 9.8% | **0.0%** |
| gaussian blur | 32.4% | 12.4% | **0.3%** |
| motion blur | 38.4% | 15.1% | **4.8%** |
| dark | 32.4% | 9.9% | **0.0%** |
| overexposed | 37.2% | 6.4% | **0.0%** |
| low contrast | 32.1% | 7.2% | **0.0%** |
| faded colour | 37.2% | 6.1% | **0.0%** |
| noise | 37.2% | 6.1% | **0.7%** |
| JPEG q=7 | 36.8% | 13.1% | **1.3%** |
| low resolution | 37.5% | 12.3% | **0.7%** |
| inverted | 32.1% | 7.1% | **0.0%** |
| rotated 90 / 180 / 270 | 84.0% / 85.9% / 81.1% | 79.0% / 81.7% / 64.5% | **0.0% / 0.2% / 0.4%** |
| skew 9° | 32.4% | 5.7% | **0.2%** |
| perspective | 37.4% | 12.2% | **0.3%** |
| shadow | 32.1% | 7.1% | **0.0%** |
| combo (180°, dark, blur, noise, JPEG) | 86.5% | 85.6% | **0.0%** |
| **all 171** (mean, essentially exact ≤ 2%) | 44.4%, 76 | 23.9%, 103 | **0.5%, 159** |

By language, Task Pipe's CER is 0.0% for Arabic, Chinese, Japanese, Korean, Spanish, French and German. It is 0.2% for English, 0.3% for Russian, 1.3% for Hindi and 1.2% for mixed English + Hindi. Plain RapidOCR cannot read Arabic, Hindi, Korean or Russian at all with its default model (90–100% CER). Even with the right script model it gets 16–54%, mostly because its per-line angle classifier flips correct lines upside-down.

### Real photos (9 images, 52 key phrases)

| System | Key phrases found | Time per photo |
| --- | ---: | ---: |
| raw RapidOCR | 33 / 52 (63%) | 1.7 s |
| **Task Pipe** | **45 / 52 (87%)** | 8.1 s |

### Compared with the earlier `ocr_pipeline.py` prototype

The prototype was tested on 54 images: the English, Hindi and mixed cards with all 18 degradations. It was given the correct language and the matching script model files, which its CLI otherwise requires you to supply by hand.

| System | Mean CER | Essentially exact | Time per image |
| --- | ---: | ---: | ---: |
| raw RapidOCR | 51.7% | 13 / 54 | 1.5 s |
| earlier prototype | 8.8% | 35 / 54 | 24.0 s |
| **Task Pipe** | **0.9%** | **44 / 54** | 4.1 s |

On the real photos the prototype found 33 of 52 key phrases, the same as raw OCR, at 25 s per photo.

## Limitations

- **Strong motion blur on Devanagari** is the weakest case (~15% CER). The deconvolution search helps Latin and Cyrillic much more.
- **The Hindi recogniser misses some rendered ligatures**, e.g. "प्लेटफॉर्म" is read as "प्लेटफॉ्म". Hand-painted Devanagari (the Hapur and Matheran boards) is read only partly.
- **Very small or out-of-focus text in a large scene** (the receipt hanging on a tree) is not detected at all.
- **Scripts without a recogniser** are skipped: Hebrew, Tifinagh, Odia, Bengali, Gujarati and Meitei, among others. Their regions produce nothing or junk below the confidence cut-off.
- **Vertical CJK writing** is treated as a sideways image.
- **Speed:** about 3 s per image on a CPU with `--langs auto`. Naming the languages or adding `--no-variants` is faster.

## Files

```text
Cluster05-Task-Pipe/
├── task_pipe.py            # CLI (files, folders, globs -> per-image results + summary)
├── taskpipe/
│   ├── pipeline.py         # TaskPipe: stages 1-8, layout, outputs
│   ├── enhance.py          # measurements, adaptive enhancement, line variants, deblur
│   ├── geometry.py         # crops, rotation with box tracking, deskew, dewarp
│   ├── ocr.py              # detector + per-script recognisers, script choice
│   └── imageio.py          # robust image loading
├── tools/
│   ├── make_benchmark.py   # render clean cards (browser) + seeded degradations
│   └── evaluate.py         # CER on the synthetic set, key-phrase recall on photos
└── tests/test_taskpipe.py  # python -m unittest discover -s Cluster05-Task-Pipe/tests
```
