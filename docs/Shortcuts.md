# Apollo Keyboard Shortcuts

`Primary modifier` means:
- macOS: `Command (⌘)`
- Windows/Linux: `Control (Ctrl)`

Notes:
- Global shortcuts are ignored while typing in text inputs.
- Some shortcuts require a selected track/group/clip.

## Transport & Project

| Shortcut | Action |
|---|---|
| `Space` | Play/Pause |
| `R` | Start/Stop recording |
| `L` | Toggle loop enabled/disabled |
| `Shift + L` | Show/hide the Lyrics track |
| `P` | Place the next lyric start while synced placement is active |
| `Primary + Z` | Undo |
| `Primary + Y` | Redo |
| `Primary + Shift + Z` | Redo |

## Track & Group Selection / Structure

| Shortcut | Action |
|---|---|
| `Arrow Up` | Select previous visible row (track/group) |
| `Arrow Down` | Select next visible row (track/group) |
| `N` | Create track below selected row (same hierarchy level) |
| `Shift + N` | Create subtrack (nest one level lower) |
| `Primary + Backspace` | Delete selected track/group |
| `Primary + Arrow Right` | Indent selected row (move in) |
| `Primary + Arrow Left` | Outdent selected row (move out, when valid) |
| `F` | Toggle fold on selected/parent group |
| `Alt + Shift + F` | Toggle fold recursively for selected/parent group |
| `M` | Toggle mute on selected track |
| `S` | Toggle solo on selected track |

## Lyrics

- Use `Shift`-double-click on a lyric bar or empty lane space to add a lyric line; the Lyrics editor is also available from the lane header.
- Toggle `Use synced lyrics` in the Lyrics lane; the setting is saved with the project. While enabled, press `P` at each line’s start. The mode remains enabled until you toggle it off.
- Drag a lyric bar to move its start. `Shift`-click a bar or use `Shift` + `Left`/`Right` to select a contiguous range, then drag any selected bar to move them together.
- Double-click a lyric bar to edit its text. `Shift`-double-click a bar or empty lane space to insert a line.

## Clip Editing

| Shortcut | Action |
|---|---|
| `Delete` / `Backspace` | Delete selected clip(s). If no clip is selected, delete selected track/group |
| `C` | Split selected clip(s) at playhead (if playhead is inside clip) |
| `Primary + X` | Cut selected clip(s) |
| `Primary + C` | Copy selected clip(s) |
| `Primary + V` | Paste clip(s) at playhead (on selected track/row) |
| `Primary + D` | Duplicate selected clip(s) |
