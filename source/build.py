#!/usr/bin/env python3
"""Builds ../index.html, the whole planner in one self-contained file.

Run from anywhere:  python3 source/build.py
It joins the app code in src/ with the libraries and fonts in vendor/, so the
page works from GitHub Pages, from a web server or as a file on a computer, offline too.
"""
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
SRC, VENDOR = HERE / 'src', HERE / 'vendor'
OUT = HERE.parent / 'index.html'

JS_ORDER = ['fonts.js', 'engine.js', 'pens.js', 'draw.js', 'three3d.js', 'storage.js', 'pdf.js', 'ui.js']
LIBS = ['three.min.js', 'OrbitControls.js', 'jspdf.umd.min.js']
ICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='5' fill='%2314202C'/%3E"
        "%3Cg fill='%23F2A51E'%3E%3Crect x='5' y='5' width='4' height='4'/%3E%3Crect x='15' y='5' width='4' height='4'/%3E%3Crect x='10' y='10' width='4' height='4'/%3E"
        "%3Crect x='5' y='15' width='4' height='4'/%3E%3Crect x='15' y='15' width='4' height='4'/%3E%3C/g%3E%3Cg fill='%235B6CFF'%3E%3Crect x='10' y='5' width='4' height='4'/%3E"
        "%3Crect x='5' y='10' width='4' height='4'/%3E%3Crect x='15' y='10' width='4' height='4'/%3E%3Crect x='10' y='15' width='4' height='4'/%3E%3C/g%3E%3C/svg%3E")


def inline_js(code):
    # keep the HTML parser from ending a script early
    return code.replace('</script', '<\\/script').replace('<!--', '<\\!--')


def main():
    css = (SRC / 'styles.css').read_text(encoding='utf-8')
    shell = (SRC / 'shell.html').read_text(encoding='utf-8')
    app = '\n'.join((SRC / f).read_text(encoding='utf-8') for f in JS_ORDER)
    libs = '\n'.join(f'<script>/* {n} (embedded) */\n{inline_js((VENDOR / n).read_text(encoding="utf-8"))}\n</script>' for n in LIBS)
    fonts = (VENDOR / 'fonts.css').read_text(encoding='utf-8')
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>LED Wall Planner</title>
<meta name="description" content="Plan LED video walls: cabinets, size, curves, data ports, NovaStar controller, power circuits, stage layout, 3D view, packing list and PDF/PNG/CSV exports. Works offline.">
<link rel="icon" href="{ICON}">
<style>
{fonts}html{{-webkit-text-size-adjust:100%;text-size-adjust:100%}}
body{{margin:0}}
[hidden]{{display:none!important}}
</style>
</head>
<body>
<style>
{css}
</style>
{shell}
{libs}
<script>
(() => {{
'use strict';
{inline_js(app)}
}})();
</script>
</body>
</html>
"""
    OUT.write_text(html, encoding='utf-8')
    print(f'wrote {OUT} ({len(html.encode()) / 1024 / 1024:.2f} MB)')


if __name__ == '__main__':
    main()
