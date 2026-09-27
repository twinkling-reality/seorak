# What's new in seorak

Shown once, in the terminal, the first time you open a session after upgrading.
Everything here ships INSIDE the package, so nothing phones home to find out
what to say and the notes work offline.

Format: one `## <version>` heading per release, matching `package.json`, newest
first. Bullets under it are the lines a reader sees. Keep them short, second
person, and about what changed for THEM, not what changed in the code.

Lines must fit the entry card: keep each under about 60 characters or it
will be clipped with an ellipsis.

## 0.3.0

- Current Claude models are priced now, Opus 5 included.
- Tools can find a session they launched by its own id.
- Launched sessions can carry the launcher's name.

## 0.2.0

- One setup command now starts local capture.
- Hooks now follow the version you upgraded to.

## 0.1.1

- Unknown flags on init, start, stop, and session now fail.

## 0.0.0

- The board is a short paragraph now, not a grid of cells.
- /view switches it to a list, or a table of every project.
- up/down focuses one project, left/right changes the window.
- Cost says "at least" when a model has no public price.
