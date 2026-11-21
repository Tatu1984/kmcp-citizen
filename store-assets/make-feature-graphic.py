"""Draws the Google Play feature graphic (1024x500) for Smart Parking.

Run from the repo root:  python3 store-assets/make-feature-graphic.py
Writes store-assets/play-feature-graphic.png — 24-bit PNG with no alpha, as
Play requires. Built on the icon's own navy so the icon sits in it seamlessly.
"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1024, 500
S = 2  # draw at 2x, then downsample, for clean edges on text and shapes

NAVY = (0, 1, 28)
NAVY_LIFT = (8, 22, 72)
GREEN = (125, 253, 81)
WHITE = (255, 255, 255)
MUTED = (178, 190, 220)
BAY_LINE = (60, 78, 130)

FONT = "/System/Library/Fonts/Avenir Next.ttc"
# Avenir Next.ttc faces: 0 Bold, 2 Demi Bold, 5 Medium, 7 Regular
def font(index: int, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT, size * S, index=index)


def background() -> Image.Image:
    """Navy with a soft blue lift behind the text and a faint glow bottom right."""
    img = Image.new("RGB", (W * S, H * S), NAVY)
    glow = Image.new("RGB", (W * S, H * S), NAVY)
    d = ImageDraw.Draw(glow)
    # Lift behind the text only; the icon's corner keeps the icon's own navy.
    d.ellipse([430 * S, -140 * S, 1240 * S, 520 * S], fill=NAVY_LIFT)
    d.ellipse([700 * S, 300 * S, 1200 * S, 720 * S], fill=(6, 30, 40))
    glow = glow.filter(ImageFilter.GaussianBlur(120 * S))
    return Image.blend(img, glow, 0.9)


def draw_bays(img: Image.Image) -> None:
    """A row of parking bays along the bottom right, one free (green)."""
    d = ImageDraw.Draw(img)
    top, bottom = 410, 500
    x = 560
    width = 74
    for i in range(7):
        free = i == 4
        colour = GREEN if free else BAY_LINE
        w = 3 if free else 2
        d.line([(x * S, top * S), (x * S, bottom * S)], fill=colour if free else BAY_LINE, width=w * S)
        d.line([((x + width) * S, top * S), ((x + width) * S, bottom * S)],
               fill=colour if free else BAY_LINE, width=w * S)
        if free:
            d.line([(x * S, top * S), ((x + width) * S, top * S)], fill=GREEN, width=3 * S)
            f = font(0, 22)
            label = "FREE"
            tw = d.textlength(label, font=f)
            d.text(((x + width / 2) * S - tw / 2, (top + 28) * S), label, font=f, fill=GREEN)
        x += width


def pill(d: ImageDraw.ImageDraw, x: int, y: int, text: str) -> int:
    f = font(5, 19)
    tw = d.textlength(text, font=f) / S
    h = 40
    w = int(tw + 52)
    d.rounded_rectangle([x * S, y * S, (x + w) * S, (y + h) * S], radius=20 * S,
                        fill=(14, 26, 70), outline=(44, 62, 120), width=1 * S)
    d.ellipse([(x + 16) * S, (y + 15) * S, (x + 26) * S, (y + 25) * S], fill=GREEN)
    d.text(((x + 34) * S, (y + 8) * S), text, font=f, fill=WHITE)
    return x + w + 12


def main() -> None:
    img = background()
    draw_bays(img)

    icon = Image.open("store-assets/play-icon-512.png").convert("RGB")
    size = 330
    icon = icon.resize((size * S, size * S), Image.LANCZOS)
    # Feather the icon's square edge into the navy so no box shows.
    mask = Image.new("L", icon.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [24 * S, 24 * S, (size - 24) * S, (size - 24) * S], radius=60 * S, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(18 * S))
    img.paste(icon, (40 * S, (H - size) // 2 * S), mask)

    d = ImageDraw.Draw(img)
    x = 400
    d.text((x * S, 118 * S), "Smart Parking", font=font(0, 64), fill=WHITE)
    d.text((x * S, 206 * S), "Find a free bay near you.", font=font(5, 30), fill=MUTED)
    d.text((x * S, 246 * S), "Pay for parking from your phone.", font=font(5, 30), fill=MUTED)

    px = x
    for label in ("Live availability", "Digital payment", "No password"):
        px = pill(d, px, 312, label)

    out = img.resize((W, H), Image.LANCZOS).convert("RGB")
    out.save("store-assets/play-feature-graphic.png", "PNG", optimize=True)
    print("wrote store-assets/play-feature-graphic.png", out.size, out.mode)


if __name__ == "__main__":
    main()
