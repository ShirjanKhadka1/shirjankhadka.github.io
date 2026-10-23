#!/usr/bin/env python3
"""Render the stocks-family Open Graph card (assets/images/og/stocks.png).

One 1200x630 card for all /stocks/ pages, drawn in the same visual language
as the existing family cards (assets/images/og/decode.png etc.): cream
background, gold rules, green kicker, serif title — plus the official brand
mark (assets/brand/nepse-decode-mark-180.png). Our own graphic; no
third-party imagery. Palette sampled from decode.png:
bg #FAF7F0, gold #B98F3E, ink #1B1A17, grey #6E6658, green #177245.
"""
from PIL import Image, ImageDraw, ImageFont

ROOT = __file__.rsplit('/tools/', 1)[0]
W, H = 1200, 630
BG, GOLD, INK, GREY, GREEN = '#FAF7F0', '#B98F3E', '#1B1A17', '#6E6658', '#177245'
SANS = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
SANS_B = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
SERIF_B = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'
SERIF = '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'

img = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(img)
d.rectangle([0, 0, W, 28], fill=GOLD)
d.rectangle([0, H - 28, W, H], fill=GOLD)

# Official brand mark, top-right (its own dark-green tile, as shipped).
mark = Image.open(ROOT + '/assets/brand/nepse-decode-mark-180.png').convert('RGBA')
mark = mark.resize((168, 168), Image.LANCZOS)
img.paste(mark, (W - 105 - 168, 66), mark)

d.text((105, 148), 'NEPSE DECODE', font=ImageFont.truetype(SANS_B, 40), fill=GREEN)
d.text((100, 218), 'NEPSE Stocks', font=ImageFont.truetype(SERIF_B, 98), fill=INK)
d.text((105, 368), 'Share price · Signals · Fundamentals · News',
       font=ImageFont.truetype(SERIF, 43), fill=GREY)
d.text((105, 428), 'Every NEPSE-listed company, on its own page',
       font=ImageFont.truetype(SERIF, 43), fill=GREY)
d.text((105, 505), 'Free · No login · Educational',
       font=ImageFont.truetype(SANS, 34), fill=GOLD)
d.text((105, 552), 'shirjankhadka.com.np',
       font=ImageFont.truetype(SANS, 33), fill=GREY)

out = ROOT + '/assets/images/og/stocks.png'
img.save(out, optimize=True)
print('wrote', out, img.size)
