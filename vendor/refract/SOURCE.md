# Refract 1.4.0

The liquid glass design system the app is built with. These files are copied unmodified from the
Refract design system (https://claude.ai/artifact/RaBZ71Jxa3wHHRURMRnDzQ, version 1790984272-0589):
its `project/components/bundle.js`, `project/components/bundle.css` and `project/components/index.d.ts`,
and `project/tokens.json`. The fonts and their licenses are the same files as before.

The bundle and style sheet arrive minified, so the app doesn't patch them: anything the app needs
differently goes through Refract's API, its attributes and the app's own CSS. `scripts/build.mjs`
passes the bundle through as it is and drops the style sheet's rules for its demo landscapes
(`.rf-art`, `.rf-scene`), which the app doesn't use. `test/buildcheck.mjs` checks these hashes, so a
changed file is noticed: to update Refract, copy the new files and write their hashes here.

| File | SHA-256 |
|---|---|
| bundle.js | fc1655838eedbbc5979e8d7323069a0fe5786f9f700d57bd88b91b1bcde547bd |
| bundle.css | 7ba81014b0141dcbff4636478c2e237780924f6ea1b8a192a12af76206a1b605 |
| index.d.ts | 7629322b5d60cb52032ce6dd566ee64883fc74281678d4c6ec29d4fa6ae2017d |
| tokens.json | 6704ac48fa75ed1e12f8f5a40921c42979473d5c12122a61383a95487277c626 |
