# No PPT

No PPT is a local React presentation editor. It opens the last presentation you used, or the complete 135-slide **AI Tectonism** deck on first run. If the browser saved the earlier eight-slide starter, the app archives it and opens the full deck on the next load. You can recover it with **File → Open archived starter draft**.

## Run locally

If you received `no-ppt-linux.zip`, extract it and serve its `dist` folder locally with Python 3. Open **http://localhost:5173** in a browser.

~~~sh
unzip no-ppt-linux.zip -d no-ppt-linux
python3 -m http.server 5173 --bind 127.0.0.1 --directory no-ppt-linux/dist
~~~

For the source checkout, use Node.js 22.12+ or 20.19+.

~~~sh
npm ci
npm run dev
~~~

Open the address Vite prints. **npm run build** generates a static build in **dist/**. **npm run preview** serves that build locally. The full deck assets stay local and load as needed.

The app accent is defined in **public/no-ppt.config**. Set `accent = #000000` for black or use another hex colour. Refresh the app after saving the file. Rebuild also if you serve the static build.

## Edit and present

- Choose a slide from the rail or enter its number below the canvas. Drag thumbnails to reorder them or use the actions below the slide list.
- Select a slide and choose **Add → Add section here** in the Slides rail to start a section at that slide. The **Slide grid** also has **Add section here** and **Rename section**. Drag slides within or between sections and click section headings to collapse them. Double-click a slide in the grid to return to the editor.
- Use **Add** for full-bleed, framed media, text + media, two-up media, or blank layouts. Drop files onto the canvas or fill media frames with uploads and direct links.
- Use the chain-link button beside **Media** to add a YouTube link or a direct video URL. In the editor, hover to play muted and move away to pause. The controls provide play or pause, reset, seeking, and mute. YouTube links show a thumbnail and offer **Open on YouTube** for videos that restrict embedding.
- Double-click text to edit it. Content changes preserve mixed formatting. Select text in the Content field to format a range in bold or italic. The **Deck** tab controls shared title, subtitle, and caption sizes. Use **Text style** on any layer to choose a role or keep its custom formatting.
- The Layers panel always lists **Title**, **Caption**, and **Text**. Use **+** beside a missing layer to add it at the default position. The **Deck** tab controls the shared sizes, including **Body size** for Text.
- Use **Ctrl+C** (or **⌘C**) to copy the selected layers. Switch slides and use **Ctrl+V** (or **⌘V**) to paste. The Layers header also has copy and paste buttons.
- Drag a layer or its resize handles to align with other layers and the slide. Hold Shift while moving a layer to lock it to the dominant drag axis. Hold Alt while dragging to bypass snapping. Use the toolbar or Ctrl+Z and Ctrl+Shift+Z to undo and redo.
- Select a layer to see its frame and resize handles. Drag an edge or corner to resize freely, or hold Shift to preserve the frame's aspect ratio. Text has a **Wrap text to frame** control.
- Hold Shift or Ctrl and click layers on the canvas or in the Layers panel to add or remove them from the selection. Drag any selected layer to move the selection together, use the arrow keys on the canvas to nudge it, or press Delete to remove it.
- Edit font family, size, color, bold, italic and alignment for selected text boxes together. The selection's X and Y fields move the whole selection while preserving spacing.
- The Layers panel groups Text, Shapes and Media. New layers follow that front-to-back order. Use **Bring forward** and **Send backward** to adjust the stacking of selected layers.
- Select a text box and use **Font family** in the Slide properties to override its inherited font. Choose the first option to restore inheritance.
- Resize handles stay accessible past the slide edge. Scroll the workspace to reach them, or use **Fit slide to canvas** to restore the centered 100% view.
- Double-click an image or choose **Crop image** in its properties. Drag inside the frame to reposition the image, use the zoom buttons to scale the image inside it, or drag the handles to change the crop window. **Mask shape** supports rectangle, rounded rectangle, and ellipse. Crop and mask settings are saved in the slide JSON.
- Add shapes with the square button beside **Media**. Shapes and connectors have editable positions, fill and stroke controls. Imported table text is editable as individual cell layers.
- **Present** starts from the current slide. Videos autoplay muted in Present, with the hover controls reserved for editing.
- Use arrow keys, Space or Page Up and Page Down to navigate a presentation. Escape returns to the editor. Chrome preloads adjacent slides, using lighter display copies for large images. The presentation controls appear when hovered or focused and omit slide numbers.

## JSON and media

Use **File → New presentation** to create a deck, or **File → Open JSON** to add a deck to the library. Click the presentation name in the top bar to switch decks. The slide rail and grid switch slides within the open deck. The app saves each deck separately in IndexedDB for the current browser and app address, and remembers the last slide when you switch.

**File → Export JSON** downloads the open deck with browser uploads embedded and bundled and remote assets linked. For deck files and media you maintain manually, use one folder per deck.

To move an edited deck between machines, use **File → Package ZIP** and transfer that file. In No PPT on the other machine, choose **File → Unpack ZIP**. The ZIP contains the open deck, its saved versions, and their local images, videos, and thumbnails. YouTube and other remote media stay linked. Install any fonts used by the deck on the destination machine.

~~~text
public/
  decks/
    project-review/
      deck.json
      media/
        cover.jpg
    design-workshop/
      deck.json
      media/
  media/              # assets you want to share across decks
~~~

Store the full ordered slide list in each `deck.json`. The app resolves relative media links from the app URL. For example, use `./decks/project-review/media/cover.jpg` from either deck. The browser library keeps its own editable copy of each JSON you open. Use **Export JSON** to update the file on disk.

**Versions → Save version** writes a numbered JSON file with the snapshot and commit message. The browser also records it in the Versions menu. Use **File → Open JSON** to reopen a version file from disk with its linked media available. Use **Package ZIP** to transfer the versions and their media to another browser. The AI Tectonism deck includes the shipped v1 checkpoint at **public/versions/no-ppt-v1.json**.

The version 1 JSON stores slides in presentation order and each slide's layers from back to front. A slide can optionally carry a **thumbnail** link for the rail and grid. Layer **x**, **y**, **w**, and **h** are percentages of slide dimensions. Text sizes use a 1600-unit design width. Text can include styled paragraph runs and text-box insets. Media layers have a **src** link with optional poster and crop. Shape layers describe their geometry, fill, and stroke. Slides and layers support simple entrance effects.

## Convert a PowerPoint deck

The Windows PowerShell converter reads the archive and extracts original assets. It reconstructs slide order, media, text, basic shapes, connectors, and table cells. It converts legacy metafile pictures to PNG. Browser rendering may differ in layout and supported effects such as PowerPoint animation timelines, and it uses source fonts when available on the device.

Regenerate the bundled deck with the command below. Stop the app server while replacing media it serves.

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/convert-pptx.ps1 -All -OutputDirectory public/full-deck -MediaUrlPrefix ./full-deck/media -ThumbnailUrlPrefix ./full-deck/thumbnails
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/prepare-screen-media.ps1
~~~

For another deck, set **-InputFile**, **-DeckName**, **-OutputDirectory**, and **-MediaUrlPrefix**. You can also run the script directly in PowerShell with a selection such as **-Slides 11,13,82** in place of **-All**. Use **-ThumbnailUrlPrefix** to link existing thumbnails under the output directory's **thumbnails/** folder. Open the generated **starter.json** from the File menu.
