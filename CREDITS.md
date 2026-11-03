# Credits and licences

## Original proposal
- *Project AKS: A Feasibility Study of a Balloon-Assisted Reusable Hypergolic Sounding Rocket for Low-Cost Near-Space Access*: Aadi Ramnani, Karthikeya Aduru, Bala Mysura Sreethan Reddy. CHIREC International School, Hyderabad. Text, equations and figures in `src/data/content.json` and `public/figures/` are reproduced from it. Figure sources are listed in Section 16.8 of the paper (Figure 1c: “Raptor testing”, Official SpaceX Photos, CC BY-NC 2.0).

## 3D models
| File | Source | Licence | Changes |
| --- | --- | --- | --- |
| procedural rockoon (`src/three/rockoon.js`) | Built for this site from Figure 2 and Sections 4, 8 and 14 of the paper | same as this repo | n/a |
| `public/models/rs25.glb` | Original procedural reconstruction (`scripts/build-rs25.mjs`), modelled on Figures 10–11 and public RS-25 geometry; contains no third-party mesh data | same as this repo | n/a |
| `public/models/turbopump.glb` | “Raptor CH4 Turbopump” by **3D Shuttle**, https://www.printables.com/model/1175221-raptor-ch4-turbopump | **CC BY-SA 4.0** | Base plate and stand removed; parts grouped into rotor and stator assemblies; re-oriented; PBR materials assigned; meshopt-compressed. The modified model is shared under CC BY-SA 4.0 |

The paper's own sources, “Turbopump for liquid rocket engine” by Max Smoliar and “Space Shuttle Main Engine (SSME) / RS-25” (GrabCAD Library), are not redistributed: GrabCAD Community models are licensed for the downloader's own non-commercial, internal use only.

## Imagery
- Earth day: NASA Blue Marble Next Generation (July 2004, topography + bathymetry), NASA Earth Observatory / Visible Earth. Public domain.
- Earth night lights: NASA Black Marble 2016. Public domain.
- Clouds: NASA Visible Earth cloud composite. Public domain.
- Water / specular mask: GEBCO_08 bathymetry (via NASA Visible Earth).

## Space background
- “Space Journey” by Akimitsu Hamamuro (akm2), https://codepen.io/akm2/pen/RwQXLdP, MIT License (full notice in `src/three/warpfield.js`). Adapted to render as the three.js scene background, stepped from the page's ticker, with touch input added.

## Fonts
- Orbitron by Matt McInerney: SIL Open Font License 1.1 (`public/fonts/OFL-Orbitron.txt`).
- D-DIN by Datto Inc.: SIL Open Font License 1.1 (`public/fonts/OFL-D-DIN.txt`).

## Software
three.js (MIT), GSAP (GreenSock standard licence, free), Lenis (MIT), KaTeX (MIT), Vite (MIT).

## Design
Layout, typography and motion are inspired by “Mission: Mars” (https://missionmars.peachworlds.com/) by Peach Worlds. No assets from that site are used.

Not affiliated with or endorsed by NASA, Aerojet Rocketdyne, SpaceX, ISRO, GrabCAD or Peach Worlds.
