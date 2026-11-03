# Project AKS: interactive rockoon story

A scroll-driven 3D website built around the original proposal **“Project AKS: A Feasibility Study of a Balloon-Assisted Reusable Hypergolic Sounding Rocket for Low-Cost Near-Space Access”** by Aadi Ramnani, Karthikeya Aduru and Bala Mysura Sreethan Reddy (CHIREC International School, Hyderabad).

The look and pacing follow [Mission: Mars](https://missionmars.peachworlds.com/): a single full-screen WebGL stage behind the page, Orbitron and D-DIN type, spec tables, counters and a phase HUD.

## What's inside

| Chapter | 3D / interaction |
| --- | --- |
| Launch, Rockoon | Procedural rockoon after **Figure 2**: zero-pressure polyethylene hydrogen balloon (inflates with altitude), parachute, heavy-load lines and a launch gondola holding the rocket. Drag to rotate; tap the markers |
| Rocket | Slender sounding rocket: polyurethane-coated SS 301 airframe, payload chamber with 3 camera windows, SS 316 grid fins, carbon-fibre fins, aerospike |
| Propellant | UDMH and N₂O₄ ball-and-stick molecules |
| Engine | RS-25 / SSME (Figures 10–11) with 13 tap hotspots and an exploded view |
| Turbopump | Sectioned turbopump (Figure 9); scroll pulls the rotating assembly apart |
| Flight | Four-phase flight from the ground to 100 km: ascent, ignition, balloon burst and burn, Kármán line. ISA telemetry |
| Dossier | The whole paper: feed system (interactive Figure 3a), materials, injector, nozzle, cooling, every equation (KaTeX), a rocket-equation calculator, a balloon-sizing calculator, the balloon trade study, permits, the 55-item bill of materials, the story timeline, Appendix A and all 48 references |

Every 3D model opens in **Explore in 3D**: one finger rotates, pinch zooms, two fingers pan, and you can tap the markers. Exploded views have a slider.

## About the 3D models in the paper

The paper credits its renders to two **GrabCAD Library** models: “Turbopump for liquid rocket engine” and “Space Shuttle Main Engine (SSME) / RS-25”. GrabCAD downloads need an account, and the GrabCAD terms license Community models for the downloader's own non-commercial, internal use only, so they cannot be republished on a public website. This site therefore uses:

- **RS-25**: an original procedural model (`scripts/build-rs25.mjs`) built to match Figures 10–11.
- **Turbopump**: “Raptor CH4 Turbopump” by 3D Shuttle (Printables, CC BY-SA 4.0), converted with `scripts/convert-turbopump.mjs`.

If the GrabCAD uploader gives written permission, put their STEP files in `models-src/turbopump/` and run:

```bash
npm i -D @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer occt-import-js
node scripts/convert-turbopump.mjs models-src/turbopump --preset grabcad-smoliar --author-permission
```

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

Pushing to `main` deploys `dist/` to GitHub Pages with `.github/workflows/deploy.yml`.

The space background is “Space Journey” by akm2 (CodePen, MIT): move the mouse to steer, press and hold (or hold a finger) to warp.

Stack: three.js, GSAP ScrollTrigger, Lenis, KaTeX, Vite. Audio is generated live with the Web Audio API (no audio files).

## Credits

See [CREDITS.md](CREDITS.md). The figures and text are reproduced from the original proposal (`public/paper/project-aks-original-proposal.pdf`).
