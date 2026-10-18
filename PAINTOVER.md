# Projection paint-over: a look workflow for fixed-camera games

Turn a plain 3D scene into a hand-painted one: render the static scene from the game camera, have an image model paint over that render, then project the painting back onto the 3D geometry. The moving parts (characters, effects) stay real 3D on top.

First trialed in Diorama Skirmish (2026-10-18, `?look=painted`). Verdict: it looked better than the lit 3D scene: more detail, same overall look, look score +0.4. The trial was a first pass (one prompt, no concept art, no tuning), so there is a lot of room left.

## When it fits

Good fit:
- The camera angle never changes, or only zooms or slides a little (autobattlers, board games, tactics games, puzzle games, point-and-click scenes, menus).
- The backdrop stays the same between redesigns: same board, table, room.
- The things that move are separate objects that can stay 3D.

Poor fit:
- An orbiting or free camera, or big angle changes. The painting is made for one viewpoint, and off that viewpoint painted details slide onto the wrong surfaces.
- Backdrops that change during play, or are generated per level, unless you're willing to repaint each one.

## The workflow

1. **Build the scene in plain 3D first.** Get the shapes, framing and lighting right in the normal look. The painting can only follow what the render shows.
2. **Render plates from the game camera, with nothing that moves in them.**
   - One plate for each different framing. Diorama Skirmish needed two: laptop 16:9, and phone 9:16 with a steeper camera.
   - Use the widest framing the game reaches, so closer framings stay inside the painting.
   - Make two versions of each plate: the normal lit render, and a plain **clay** render (flat grey, simple shading). Keep important lines in the clay version; in Diorama Skirmish that was the grid between cells.
   - Save the exact camera with each plate. The projection needs it.
3. **Paint over the clay plate with an image model.**
   - Send the clay plate as the image to paint over, the lit plate as the colour and material guide, and concept art if you have it (it makes the biggest difference).
   - In the prompt, insist that nothing moves: same camera, every edge and grid line exactly in place, no characters, no text.
   - Make several versions on different models. Models vary a lot in how well they hold the layout.
4. **Pick by alignment first, beauty second.** Measure how well each painting's edges line up with the render; don't trust your eye. In the trial, two paintings that looked fine were 2% off or reframed, which would have put painted grid lines off the real cells. Choose the prettiest of the ones that line up.
5. **Project it back.**
   - Give the static geometry an unlit material that looks up each point's colour in the painting, as seen from the saved camera.
   - Anywhere the painting doesn't reach, fall back to the normal lit material.
   - Make the moving pieces cast shadows onto the painting, and stop the static pieces casting shadows (those are already painted in).
   - Undo or switch off any colour grading the game adds, so the painting shows as painted.
6. **Check it in the real game.** Take screenshots at every framing the camera actually reaches, plus one at an extreme angle to see where it breaks. Compare it side by side with the old look, mid-action.
7. **Keep it behind a switch at first**, so both looks can be judged on the live game before one becomes the default.

## Cost and time (Diorama Skirmish trial, Meshy image-to-image)

- About 9 credits per painting on Nano Banana Pro and 12 on GPT Image 2. Each took about 30 seconds (one took 2.5 minutes).
- The whole trial cost 63 credits: three laptop paintings, three phone paintings.
- A repaint after the board changes takes about 2-3 minutes and about 20 credits, plus a look at the results.

## What to watch for

- **Things that stick up** (lamps, posts, corner pieces). They line up from the painting's camera but slide onto the floor or table from any other angle. Keep them as real 3D if the camera moves at all.
- **The model guessing at the edges.** If something is half out of frame, the model may paint its own version of it. In the trial, a lamp on the phone plate turned into a green smudge on the table.
- **Characters looking pasted on.** Crisp, shiny 3D figures on a soft painting read as stickers. Pull their lighting, colours and edges toward the painting.
- **Style drift.** The model may restyle more than you asked for. In the trial, the table became a brushed patch on a blue background.

## Where to take it next

Roughly in order of how much each is worth:
1. Concept art as the style target, and several rounds of paintings.
2. Make the 3D figures match the painting: warmer, flatter shading, soft outlines, shared colour grading.
3. Paint a margin past the screen edges so the lit fallback never shows.
4. Fix the bad spots in a good painting instead of repainting all of it.
5. Bring the painting to life: light from effects glowing on it, a flickering light pool, shadows tinted to match the paint.

## In this repo

- `look-experiment/`: plates, clay renders, every painting, the prompt, `compare.png`, and a README with the repaint commands.
- `scripts/paintover.mjs`: renders the plates, sends the paint-over requests to Meshy, and installs the chosen painting.
- `src/view/painted.js`: the projection, the lit fallback, and the mini shadows.
- `npm run check -- --looks`: plays the same fight in both looks and writes the side-by-side comparison.
