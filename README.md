# LED Wall Planner

Plan LED video walls in the browser: cabinets and size, curved screens, data ports and NovaStar controller, power circuits, mounting, stage layout, 3D view, packing list, and PDF, PNG and spreadsheet exports.

**Open the planner: https://juicypeachxx.github.io/Led-wall-calc/**

It works on a computer, tablet or phone, in Chrome, Safari, Edge or Firefox. Once loaded it also works offline, and `index.html` can be downloaded and opened as a file on a computer.

## Starting a project

The planner opens with an empty stage. Either tap a screen type (main, side, totem, banner, DJ booth front, arc or free), or under **Your own size** pick the panel (your own panels included), type the width × height in metres or in cabinets, choose flown or ground stack, and tap **Add screen**. Add more screens with **Add screen**, which also has **Your own size…**. **New** starts another empty project. The example festival stage is under **Open › Open the example project**.

## Your panels

Add your own cabinets with **New panel** (in the Panel card or on the start card): brand, model, size, pixels, weight, power and, if you like, how many you have in stock. They show in every panel list, grouped by brand, in every project, and are saved in the browser you use. When a project needs more cabinets of a panel than you have in stock, the planner says so.

**Your panels › Import Excel or CSV** reads a spreadsheet with one row per panel; on an iPad the file picker also reaches Google Drive. Importing the same file again updates the panels with the same brand and model. **Export** writes your list as a CSV file with the same columns.

A project keeps a copy of each panel it uses, so a project file works anywhere. If a panel changes in your list later, the project offers to use the new values.

### A panel list for every device: panels.xlsx

Upload your Excel file to this repository with the name **`panels.xlsx`**, next to `index.html` (on github.com: **Add file › Upload files**, then **Commit changes**). The planner reads it every time it opens, on every device and for everyone who uses the link, and keeps the last copy for offline use. To change the list, edit the file and upload it again; the site updates about a minute later. A `panels.csv` file works too.

Start from **[panels-template.xlsx](panels-template.xlsx)**. Columns: **Brand**, **Model**, **Width (mm)**, **Height (mm)**, **Pixels across**, **Pixels down** (or **Pitch (mm)** instead of the pixel counts), and optionally **Weight (kg)**, **Max power (W)**, **Typical power (W)** and **Stock**. Decimal commas or points both work, and Slovenian column names such as Znamka, Širina, Višina, Teža, Moč and Zaloga are recognised.

This repository is public, so anyone can download `panels.xlsx`. Leave stock numbers out of that copy if they are private, and use **Import** for them instead.

## What it does

- **Panels:** generic 500×500, 500×1000, 600×337.5, 640×480, 960×960 and 1000×1000 cabinets, and your own panels (see above).
- **Size:** by columns × rows, by metres (nearest, fit inside or cover), or large and small cabinets mixed from stock. Suggests sizes close to 16:9.
- **Shape:** flat, curved in or curved out, with the calculated radius, chord and depth.
- **Empty positions:** click a cabinet in the plan to leave its position empty.
- **Data:** snake or Z routing along rows or columns from any corner, whole rows or fill to capacity per port (650,000 px per port by default, 325,000 for 10-bit), optional backup cables.
- **Controller:** suggests a NovaStar VX Pro controller for the whole project, or checks the one you choose, with an output-by-output table.
- **Power:** circuits from breaker size, voltage, maximum load and power factor, following the data path.
- **Mounting:** flown or ground stack for each screen. Flown screens are built from the top row down and hang from flying bars. Ground stacks are built from the bottom row up and stand on ground beams with adjustable feet, one per cabinet column. Behind the screen, at the joints between beams, stand H-frames (a ladder on a pair of floor rails, clamped to the cabinets) and, if you like, single posts between them. In the Mounting card you set an H-frame every so many beams (always at both ends), posts between or not, the frame height and how many arms clamp each H-frame or post to the screen, and tap any joint to switch it between H-frame, post and nothing. The planner gives the loads for the rigging or structural design (weight per metre, heaviest column, centre of gravity, front area for wind), draws the mounting in the layout and the 3D view, and adds flying-bar lengths, ground beams, H-frames, posts and arms to the packing list.
- **Stage:** several screens on one stage with snapping and alignment, a 3D view with a 1.75 m person for scale.
- **Exports:** PDF report (overview, 3D view, controller, elevations with build order, data cabling, specifications and power, packing list), layout and plan PNGs, pixel map PNG at native resolution, packing list and cabinet list spreadsheets (CSV), and the project file (JSON).

## Saving

Projects save automatically in the browser you use, on that device, as soon as you change something, and the planner reopens the last project you worked on. To move a project to another device or send it to someone, use **Export › Project file** and then **Import** on the other side.

## Keep in mind

- Weight and power of the generic cabinets are typical values, not a specific product. For exact figures use your own panels with their datasheet values.
- Current is calculated as watts ÷ (volts × power factor); the default power factor is 0.95.
- Pixels per data port and controller capacities are NovaStar's 8-bit, 60 Hz figures. Colour depth and frame rate change them, so check your processor.
- Minimum viewing distance uses the 1 m per mm of pixel pitch rule of thumb.
- Loads are for the cabinets only: flying bars, ground beams, H-frames, cables and wind add to them. Follow the ground-stack system's instructions for the frames and their height.
- Reading Excel files needs a recent browser (Safari 16.4 or later on iPad and iPhone). Older browsers can import the list saved as CSV.
- The planner documents geometry and configuration. It does not check structure, rigging or the electrical installation; have those checked by the responsible engineer.

## Changing the planner

The app code is in `source/src`. After changing it, run `python3 source/build.py`, which rebuilds `index.html` with the libraries and fonts from `source/vendor` embedded.

## Third-party software and fonts

- [three.js](https://threejs.org/) r128 (MIT License)
- [jsPDF](https://github.com/parallax/jsPDF) 2.5.1 (MIT License)
- [Barlow and Barlow Condensed](https://github.com/jpt/barlow) by Jeremy Tribby (SIL Open Font License 1.1)
- [IBM Plex Mono](https://github.com/IBM/plex) (SIL Open Font License 1.1)
