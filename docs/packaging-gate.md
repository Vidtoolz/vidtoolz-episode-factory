# Packaging Gate

The Packaging Gate is the pass/fail check before a rough episode idea should move deeper into scripting and production.

It exists to prevent a solo creator from spending recording and editing energy on an unclear package.

## Checks

- Viewer and problem are specific.
- Promise is useful and believable.
- At least three title options exist.
- Thumbnail concept can be read quickly.
- Hook creates immediate tension or curiosity.
- Script outline supports the promise.
- Production and editing needs are clear.

## How To Use It

Use the gate while the episode is in `Packaging` or before moving from `Script` to `Ready to Shoot`.

A failed gate does not block the app from changing status. It is a discipline signal, not a hard workflow lock. The creator remains the final editor.

## Pass State

Each gate item stores a boolean `passed` value inside the episode object:

```js
packagingGate: {
  "Viewer and problem are specific": { passed: true }
}
```

The board card shows the gate count, such as `Gate 4/7`, so weak packages remain visible without opening the full detail view.
