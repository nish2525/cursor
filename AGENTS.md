# Animal Atlas project instructions

- Preserve the original Three.js world in `sky-world.js`. Keep the islands, airship, flight, docking, drag/zoom controls, clouds and day/night lighting in 3D.
- Work in the existing `nish2525/cursor` repository. Use a development branch and open a pull request for significant changes. Leave merging to the reviewer.
- This is a build-free static website. Run `python -m http.server 8000` from the repository root. Use relative asset paths so the site also works under the GitHub Pages `/cursor/` path.
- Edit text, animal names and images in `wildlife.js`. Keep habitat keys stable because flight commands and share links use them. Keep content changes out of the rendering engine.
- Keep the pinned Three.js module and its licence together in `vendor/`. Avoid adding network dependencies or build tools for basic content changes.
- When changing flight or UI, check Chromium's console and WebGL rendering. Test menu selection, clicking an island or its label, docking, closing and revisiting the panel, and day/night switching. Check a narrow viewport and a habitat URL such as `#ocean`.
- Explain changes in simple English. Name the file to edit and give the student one small change they can verify on their own.
