# Animal Atlas

Animal Atlas is a student ECA project. Fly an airship through a Three.js world and visit four floating islands to discover their wildlife.

## Run it locally

1. Clone this repository or download it from GitHub and unzip it.
2. Open a terminal in the project folder. Run the command below. On Windows, use `py` in place of `python` if needed.
3. Open [http://localhost:8000/](http://localhost:8000/) in your browser. Press Ctrl+C in the terminal to stop the server.

```sh
python -m http.server 8000
```

Open the server address because browsers restrict JavaScript module imports when you double-click `index.html`. Use a browser with WebGL 2 enabled. The site ships with Three.js r165 in `vendor/`, so it can run without an internet connection after you download it.

## Explore the world

- Select a habitat in the menu, click its 3D island, or use its map label. The airship flies to the pier and opens the wildlife panel.
- Press W A S D or the arrow keys to steer after clicking the 3D scene. Drag to look around, scroll to zoom, and hold Shift to fly faster.
- Use Escape to cast off or the moon button to switch to night. Share a specific habitat using a link ending in its key, such as `#ocean`.

## Edit the wildlife

Start in [wildlife.js](wildlife.js). Each habitat has a title, a short introduction, and an `animals` list. Edit a record, save, and refresh the page. Visit that habitat to check it.

To add a photo, place it in an `images` folder inside the project. Use a photo you have permission to share, and credit its source if required. Add these lines to the animal record after its description:

```js
image: "./images/green-sea-turtle.jpg",
imageAlt: "A green sea turtle swimming above a reef",
```

The icon appears when the photo is missing. Keep each description short enough to read on a phone.

## Where the code lives

| File | What it does |
| --- | --- |
| `wildlife.js` | Habitat names, animal records, icons, and optional photos |
| `index.html` | Website layout, island positions, navigation, and wildlife panels |
| `sky-world.js` | Original 3D geometry, airship movement, lighting, camera, and docking |
| `vendor/` | Pinned Three.js module and MIT licence |

If the site fails, open DevTools and check **Console** for the first red error. Check **Network** for missing files. For example, a 404 for a photo usually means the path or filename in `wildlife.js` needs correcting. Check that WebGL is available if the error mentions a WebGL context.

## Publish with GitHub Pages

After the review branch is merged, open **Settings → Pages** in the repository. Set **Source** to **Deploy from a branch**, choose **main** and **/ (root)**, and save. Wait for the Pages deployment in **Actions**. Then open [the GitHub Pages URL](https://nish2525.github.io/cursor/) and try flying to an island.
