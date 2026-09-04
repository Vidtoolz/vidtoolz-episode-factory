# Mobile readability oracle

Presentation is 1080×1920. Minimum safety margins are 72 px left/right, 96 px top, and 144 px bottom. The evidence box must remain inside them, at least 640×360, without overlap/clipping. Rendered relevant text must be at least 32 px and declared transforms may zoom at most 4× while retaining required context.

Safe-area success and readability are separate gates. The harness rejects tiny evidence, tiny text, unsafe placement, wrong dimensions, excessive zoom, and context-destroying crop.
