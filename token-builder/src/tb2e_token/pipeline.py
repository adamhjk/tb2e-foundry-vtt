"""Image processing pipeline: download, background removal, crop, resize, WebP export."""

import io
from urllib.request import urlopen

from PIL import Image
from rembg import remove


def download_image(url):
    """Download an image from a URL and return a PIL Image."""
    with urlopen(url) as response:
        data = response.read()
    return Image.open(io.BytesIO(data))


def remove_background(image):
    """Remove the background from an image using rembg, returning an RGBA image."""
    return remove(image)


def crop_to_content(image, padding_pct=0.05):
    """Crop to non-transparent content, pad to square with a margin."""
    bbox = image.getbbox()
    if bbox is None:
        return image

    left, upper, right, lower = bbox
    width = right - left
    height = lower - upper

    # Add padding
    pad_x = int(width * padding_pct)
    pad_y = int(height * padding_pct)
    left = max(0, left - pad_x)
    upper = max(0, upper - pad_y)
    right = min(image.width, right + pad_x)
    lower = min(image.height, lower + pad_y)

    cropped = image.crop((left, upper, right, lower))

    # Pad to square
    w, h = cropped.size
    side = max(w, h)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    offset_x = (side - w) // 2
    offset_y = (side - h) // 2
    square.paste(cropped, (offset_x, offset_y))

    return square


def resize_image(image, size):
    """Resize to size x size using LANCZOS resampling."""
    return image.resize((size, size), Image.LANCZOS)


def save_webp(image, path, quality=90):
    """Save image as WebP with alpha channel."""
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(str(path), "WEBP", quality=quality, method=6)


def process_image(image, *, size=400, quality=90, output_path, remove_bg=True,
                  keep_intermediate=False):
    """Run the full pipeline: bg removal → crop → resize → WebP export."""
    if keep_intermediate:
        raw_path = output_path.with_suffix(".raw.png")
        image.save(str(raw_path), "PNG")
        print(f"  Raw image saved: {raw_path}")

    if remove_bg:
        image = remove_background(image)
        if keep_intermediate:
            nobg_path = output_path.with_suffix(".nobg.png")
            image.save(str(nobg_path), "PNG")
            print(f"  Background removed: {nobg_path}")
    else:
        image = image.convert("RGBA")

    image = crop_to_content(image)
    image = resize_image(image, size)
    save_webp(image, output_path, quality=quality)

    return image
