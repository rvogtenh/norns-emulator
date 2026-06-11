# UI Redesign Requirements

> Added: 2026-06-02

## Layout

### Controls (Encoder/Key arrangement)
Match physical Norns layout:
- **Upper left**: K1 + E1 (grouped together, stacked: key above encoder)
- **Lower right**: K2+K3 (keys row) above E2+E3 (encoders row)
- Separation between left group (E1/K1) and right group (E2+K2/E3+K3) is intentional

### Device + Panel height
Device section and side panel (script/tempo/MIDI/params) default to the same height (`align-items: stretch`).

### Grid + Arc
- Stacked vertically (one below the other, not side by side)
- **Closed state**: width ~half the Norns display (~320px), more horizontal space between label and show button
- **Open state**: expands to full Norns display width (~640px)

### Max width / Responsive
- Overall max width: ~840px
- Responsive scaling from mobile to desktop
- Canvas scaling (full responsive Norns display resize): future enhancement (Phase 6)

## Typography

- **Font**: Arial, Helvetica, sans-serif (body); keep monospace for console
- **Title**: NORNS EMULATOR — uppercase, large
- **Keyboard labels** (kbd): larger and more readable (min 12px)
- **Form inputs / labels**: larger (13px+)
- **Param entries**: more vertical spacing between rows

## Implemented
- [x] Controls layout (E1/K1 left, E2+K2/E3+K3 right)
- [x] Font change (Arial/Helvetica)
- [x] Uppercase title (CSS text-transform)
- [x] kbd size increase (11–12px, font-weight 600/700)
- [x] Form input size increase (13px, mehr padding)
- [x] Param row spacing (6px, war 3px)
- [x] Grid/Arc stacked + responsive width (:has() → 340px closed, 688px open)
- [x] Device + panel equal height (align-items: stretch)
