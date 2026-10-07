# Task Pipe benchmark

Test data for [`Cluster05-Task-Pipe`](../../Cluster05-Task-Pipe/README.md): degraded images with known text, used to measure how well the enhance-then-OCR pipeline works.

## Synthetic set (`clean/`, `degraded/`, `ground_truth.json`)

`clean/` holds 13 text cards in 11 languages: English, Spanish, French, German, Hindi, Russian, Arabic, Chinese, Japanese, Korean and mixed English + Hindi. A headless Chromium browser rendered them, which shapes complex scripts correctly: Devanagari conjuncts and Arabic letter joining come out right. Pillow cannot do this without libraqm.

`degraded/` contains 171 copies of those cards with seeded distortions:

| Degradation | What it simulates |
| --- | --- |
| `gauss_blur`, `motion_blur` | Out-of-focus photo, camera shake |
| `dark`, `overexposed`, `low_contrast`, `faded_color` | Bad exposure, haze, yellowed paper |
| `noise`, `jpeg`, `low_res` | Sensor noise with salt-and-pepper pixels, heavy compression, tiny image |
| `inverted` | Negative / light text on a dark background |
| `rot90`, `rot180`, `rot270`, `skew` | Sideways, upside-down or tilted capture |
| `perspective` | Page photographed at an angle |
| `shadow` | Uneven lighting with a hand or phone shadow |
| `combo` | Upside-down, dark, blurred, noisy JPEG |

Six cards get all 18 degradations. The others get 9.

`degraded/` is reproducible from `clean/`: the degradations are seeded, and recreating them needs no browser.

```powershell
python Cluster05-Task-Pipe/tools/make_benchmark.py --skip-render
```

To re-render the clean cards as well, omit `--skip-render`. This needs Edge or Chrome.

## Real photos (`real/`, `real/ground_truth.json`)

Nine photographs from Wikimedia Commons. Scenes contain more text than is transcribed, so each photo lists **key phrases** that the OCR output should contain.

| File | Content | Licence | Author |
| --- | --- | --- | --- |
| `hapur_station_board.jpg` | Hand-painted Hindi/English/Urdu station board | CC BY-SA 4.0 | Superfast1111 |
| `matheran_platform_board.jpg` | Marathi/Hindi/English board, weathered paint | CC0 | Historical Trains |
| `rani_kamlapati_board.jpg` | Hindi/English sign mounted at 45° | CC BY-SA 4.0 | Suyash Dwivedi |
| `busan_russian_sign.jpg` | Night photo with Korean, Russian and a phone number | CC BY 4.0 | Прикли |
| `seoul_cheonho_station.jpg` | Korean/English/Chinese/Japanese metro sign | CC0 | Striker9498 |
| `sf_chinatown_clay_st.jpg` | English/Chinese street sign, angled | CC BY-SA 4.0 | Daniel Schwen |
| `agadir_trilingual_signs.jpg` | Arabic/Tifinagh/French road signs, small image | CC BY-SA 4.0 | AyourAchtouk |
| `vienna_grocery_receipt.jpg` | Crumpled German receipt under uneven light | Public domain | Grandmaster Huon |
| `tesco_receipt_on_tree.jpg` | Blurry low-resolution receipt (stress case) | CC BY-SA 2.0 | Lee Cooper |

The images are the 1280 px Commons thumbnails, or the originals where those were smaller. Source pages are listed in `real/sources.json`. Keep this attribution with redistributed copies.
