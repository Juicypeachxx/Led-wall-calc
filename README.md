# LED Wall Planner

Plan LED video walls in the browser: cabinets and size, curved screens, data ports and NovaStar controller, power circuits, stage layout, 3D view, packing list, and PDF, PNG and spreadsheet exports.

**Open the planner: https://juicypeachxx.github.io/Led-wall-calc/**

It works on a computer, tablet or phone, in Chrome, Safari, Edge or Firefox. Once loaded it also works offline, and `index.html` can be downloaded and opened as a file on a computer.

## What it does

- **Panels:** generic 500×500, 500×1000, 600×337.5, 640×480, 960×960 and 1000×1000 cabinets, or your own cabinets from their datasheet (size, pixels, weight, power).
- **Size:** by columns × rows, by metres (nearest, fit inside or cover), or large and small cabinets mixed from stock. Suggests sizes close to 16:9.
- **Shape:** flat, curved in or curved out, with the calculated radius, chord and depth.
- **Empty positions:** click a cabinet in the plan to leave its position empty.
- **Data:** snake or Z routing along rows or columns from any corner, whole rows or fill to capacity per port (650,000 px per port by default, 325,000 for 10-bit), optional backup cables.
- **Controller:** suggests a NovaStar VX Pro controller for the whole project, or checks the one you choose, with an output-by-output table.
- **Power:** circuits from breaker size, voltage, maximum load and power factor, following the data path.
- **Stage:** several screens on one stage with snapping and alignment, a 3D view with a 1.75 m person for scale.
- **Exports:** PDF report (overview, 3D view, controller, elevations with build order, data cabling, specifications and power, packing list), layout and plan PNGs, pixel map PNG at native resolution, packing list and cabinet list spreadsheets (CSV), and the project file (JSON).

## Saving

Projects save automatically in the browser you use, on that device. To move a project to another device or send it to someone, use **Export › Project file** and then **Import** on the other side.

## Keep in mind

- Weight and power of the generic cabinets are typical values, not a specific product. For exact figures add your cabinet as a custom panel.
- Current is calculated as watts ÷ (volts × power factor); the default power factor is 0.95.
- Pixels per data port and controller capacities are NovaStar's 8-bit, 60 Hz figures. Colour depth and frame rate change them, so check your processor.
- Minimum viewing distance uses the 1 m per mm of pixel pitch rule of thumb.
- The planner documents geometry and configuration. It does not check structure, rigging or the electrical installation; have those checked by the responsible engineer.

## Changing the planner

The app code is in `source/src`. After changing it, run `python3 source/build.py`, which rebuilds `index.html` with the libraries and fonts from `source/vendor` embedded.

## Third-party software and fonts

- [three.js](https://threejs.org/) r128 (MIT License)
- [jsPDF](https://github.com/parallax/jsPDF) 2.5.1 (MIT License)
- [Barlow and Barlow Condensed](https://github.com/jpt/barlow) by Jeremy Tribby (SIL Open Font License 1.1)
- [IBM Plex Mono](https://github.com/IBM/plex) (SIL Open Font License 1.1)
