# Sweep screens per area

`test/sweep.mjs` loads every `*.mjs` file here, in name order, and adds the screens it returns to the
sweep. One file per area (for example `badges.mjs`, `setup.mjs`), so areas never edit the same list.

Each file exports `screens(ctx)`, which returns `[id, run]` pairs like the ones in `sweep.mjs`. `run`
is an async function that leaves the screen or sheet to check open. `ctx` holds the sweep's helpers:
`page`, `settle(ms)`, `act(name, arg)`, `reset()`, `setup(n, pick)`, `chips(selectors)`,
`startAct(type, o)` and `seedActs()`.

```js
export async function screens({ page, settle }) {
  return [
    ['you', async () => { await page.evaluate(() => window.GH.ui.go('you')); }],
  ];
}
```
