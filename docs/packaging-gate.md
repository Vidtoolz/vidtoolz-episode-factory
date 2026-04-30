# Packaging Gate

The Packaging Gate is the pass/fail check before a rough episode idea should move deeper into scripting and production.

It exists to prevent a solo creator from spending recording and editing energy on an unclear package.

## Checks

- Viewer problem is clear.
- Target viewer is specific.
- Core promise is concrete.
- Title is specific.
- Hook works in the first 5 seconds.
- Thumbnail concept is understandable without reading the title.
- Topic is narrow enough for a 10-14 minute video.
- Episode can produce at least 3 Shorts.

## How To Use It

Use the gate while the episode is in `Packaging` or before moving from `Script` to `Ready to Shoot`.

A failed gate does not block the app from changing status. It is a discipline signal, not a hard workflow lock. The creator remains the final editor.

## Pass State

Each gate item stores a boolean `passed` value inside the episode object:

```js
packagingGate: {
  "Viewer problem is clear": { passed: true }
}
```

The checklist group shows the gate count, such as `4/8`, so weak packages remain visible inside the episode detail view.

In v0.2 the board card also shows readiness percentages. Packaging readiness is the Packaging Gate completion percentage.
