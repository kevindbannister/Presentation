# Presentation

Presentation is a local presentation-control app for PowerPoint and OBS.

## Current prototype

- Import a .pptx file and read slide notes for # commands.
- Preview slide text, images and basic shapes.
- Present through an OBS Browser Source at http://127.0.0.1:5175/output.
- Connect to OBS WebSocket to switch scenes and show or hide sources.
- Use the app's next/previous controls or keyboard arrows. The bridge includes local next/previous endpoints for same-computer automations.
- Stream Deck remains available for manual OBS control.

## Run locally

1. Install Node.js 20 or later.
2. In this repository, run npm install.
3. Run npm start.
4. Open http://127.0.0.1:5175.
5. In OBS, add a Browser Source with URL http://127.0.0.1:5175/output.
6. In OBS, enable WebSocket Server in Tools > WebSocket Server Settings. Keep authentication enabled.
7. Enter the OBS WebSocket address and password in Presentation > OBS connection.

The app is intended to run on the same computer as OBS. The local bridge binds to 127.0.0.1 and does not expose OBS control over the network.

## Notes commands

Put one command per line in PowerPoint speaker notes:

- #scene: Scene Name
- #source.show: Source Name
- #source.hide: Source Name

Multiple commands are supported. Scene and source names must match OBS. Use source visibility commands to select portrait or landscape layouts, for example showing the Portrait Frame source and hiding the Landscape Frame source.

## Flic

The bridge provides local endpoints for next and previous slide commands:

- GET http://127.0.0.1:5175/api/next
- GET http://127.0.0.1:5175/api/previous

They can be called by automation running on the same computer. A Flic Hub on another device cannot reach this loopback-only server yet; that needs a secured local-network connector and should be added once the Flic model and setup are confirmed.

## Scope and limitations

This is an initial, local-first prototype. PPTX rendering focuses on common text, images and shapes; complex PowerPoint effects, embedded video, fonts and animations may not match PowerPoint exactly. Export a PDF or images from PowerPoint if a deck relies on effects that do not render in the prototype. OBS slide animation runs inside the Browser Source; OBS scene transitions apply when the app changes scenes.


This first build runs locally because OBS control requires a local bridge. It is not a GitHub Pages deployment.
