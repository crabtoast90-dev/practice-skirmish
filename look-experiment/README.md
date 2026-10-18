# Look experiment: projection paint-over

Try it: the game with `?look=painted` (lit is the default and unchanged).

- `plate-*.png` / `clay-*.png`: the empty board from the play camera (shop open, the widest framing), lit and plain clay. `plate-*.json`: that camera.
- `painted-*-<model>-<n>.png`: the Meshy paint-overs (prompt in `prompt.txt`). Clay was the image painted over, the lit plate the colour reference.
- In use: laptop `painted-laptop-nano-banana-pro-1.png` (grid within 1 px of the board; both GPT Image 2 laptop variants slid 2% or reframed), phone `painted-phone-gpt-image-2-1.png` (best grid match of three).
- `compare.png`: lit vs painted, laptop and phone, mid-fight (written by `npm run check`).

Repaint after the board changes: `node scripts/paintover.mjs --plates`, then
`NODE_USE_ENV_PROXY=1 node scripts/paintover.mjs --paint=laptop:nano-banana-pro,phone:gpt-image-2`, look at the results,
then `node scripts/paintover.mjs --use=laptop:<file>` (and phone). About 2 minutes, 21 credits.
