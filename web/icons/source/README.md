# Icon sources

Full-size originals for the published icons in `web/icons/`. The build copies
the derived files only; nothing in this folder is deployed.

| Source | Derived files |
|---|---|
| `base-icon-dark.png` | `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, `logo-64.png`, and `icon-maskable-512.png` through `maskable.html` |
| `small-icon.png` | `favicon-32.png`, `favicon-16.png`, from a 960 px square crop around the TV |
| `social-banner.png` | `social-card.jpg` through `social-card.html`, which sets the wordmark and tagline in the site's fonts |

To regenerate on macOS, from the repository root:

```sh
cd web/icons
sips -c 960 960 --cropOffset 122 146 source/small-icon.png --out /tmp/small-crop.png
sips -z 32 32 /tmp/small-crop.png --out favicon-32.png
sips -z 16 16 /tmp/small-crop.png --out favicon-16.png
for size in 180:apple-touch-icon 192:icon-192 512:icon-512 64:logo-64; do
  sips -z "${size%%:*}" "${size%%:*}" source/base-icon-dark.png --out "${size#*:}.png"
done
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
shot() { "$chrome" --headless=new --allow-file-access-from-files --hide-scrollbars --force-device-scale-factor=1 --window-size="$1" --screenshot="$2" "file://$PWD/source/$3"; }
shot 512,512 icon-maskable-512.png maskable.html
shot 1200,630 /tmp/social-card.png social-card.html
sips -s format jpeg -s formatOptions 85 /tmp/social-card.png --out social-card.jpg
```
