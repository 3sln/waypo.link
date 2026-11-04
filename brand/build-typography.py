#!/usr/bin/env python3
"""Outline the hosted wordmark with pinned Manrope; no font request at runtime.
Requires fonttools==4.60.1. Raster output is rendered by build-typography.mjs.
"""
import hashlib
import json
from pathlib import Path
import fontTools
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'brand/typography'
ASSETS = ROOT / 'site/assets'
provenance = json.loads((SOURCE / 'provenance.json').read_text())
font_path = SOURCE / 'Manrope[wght].ttf'
assert fontTools.__version__ == '4.60.1', 'Use the pinned outline tool'
assert hashlib.sha256(font_path.read_bytes()).hexdigest() == provenance['files'][font_path.name]['sha256']

def number(value):
    return format(value, '.3f').rstrip('0').rstrip('.') or '0'

def outline(text, size, x, baseline, weight=600, tracking=0):
    font = instantiateVariableFont(TTFont(font_path), {'wght': weight}, inplace=False)
    glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
    scale = size / font['head'].unitsPerEm
    gpos = font['GPOS'].table
    kern_indices = {i for f in gpos.FeatureList.FeatureRecord if f.FeatureTag == 'kern' for i in f.Feature.LookupListIndex}
    def kerning(left, right):
        total = 0
        for index in sorted(kern_indices):
            lookup = gpos.LookupList.Lookup[index]
            for subtable in lookup.SubTable:
                table = subtable.ExtSubTable if lookup.LookupType == 9 else subtable
                kind = subtable.ExtensionLookupType if lookup.LookupType == 9 else lookup.LookupType
                if kind != 2 or left not in table.Coverage.glyphs:
                    continue
                value = None
                if table.Format == 1:
                    pairs = table.PairSet[table.Coverage.glyphs.index(left)].PairValueRecord
                    value = next((pair.Value1 for pair in pairs if pair.SecondGlyph == right), None)
                elif table.Format == 2:
                    one = table.ClassDef1.classDefs.get(left, 0)
                    two = table.ClassDef2.classDefs.get(right, 0)
                    value = table.Class1Record[one].Class2Record[two].Value1
                total += getattr(value, 'XAdvance', 0) if value else 0
        return total
    paths, previous, start = [], None, x
    for char in text:
        name = cmap[ord(char)]
        if previous:
            x += kerning(previous, name) * scale
        pen = SVGPathPen(glyphs, ntos=number)
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, baseline)))
        if pen.getCommands():
            paths.append(pen.getCommands())
        x += font['hmtx'][name][0] * scale + tracking
        previous = name
    return '<path fill="currentColor" d="' + ''.join(paths) + '"/>', x - start - tracking

wordmark, advance = outline('waypo.link', 110, 10, 116, tracking=-1.3)
width = round(advance + 24)
icon = (ASSETS / 'waypo-link-icon.svg').read_text().strip()
inner_icon = icon[icon.index('>') + 1:icon.rindex('</svg>')]
wordmark_svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} 160" color="#174B3E" role="img" aria-label="Waypo.link">{wordmark}</svg>\n'
lockup_width = width + 185
lockup_inner = f'<g transform="translate(0 8) scale(.56)">{inner_icon}</g><g transform="translate(171 0)" color="#174B3E">{wordmark}</g>'
lockup_svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {lockup_width} 160" role="img" aria-label="Waypo.link">{lockup_inner}</svg>\n'
first, _ = outline('Your identity.', 80, 64, 280, weight=700, tracking=-2)
second, _ = outline('Your way onward.', 80, 64, 378, weight=700, tracking=-2)
caption, _ = outline('Personal identity and services at waypo.link', 25, 68, 548, weight=500)
social = f'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="Waypo.link. Your identity. Your way onward."><rect width="1200" height="630" fill="#F7F5EE"/><circle cx="1190" cy="620" r="255" fill="#BDE9D5"/><g transform="translate(64 44) scale(.52)">{lockup_inner}</g><g color="#174B3E">{first}{second}{caption}</g><g transform="translate(924 108) scale(.8)">{inner_icon}</g></svg>\n'
for name, value in [('waypo-link-wordmark.svg', wordmark_svg), ('waypo-link-lockup.svg', lockup_svg), ('waypo-link-social.svg', social)]:
    (ASSETS / name).write_text(value)
    print(name, len(value), 'bytes')
