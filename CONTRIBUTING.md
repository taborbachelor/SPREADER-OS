# Contributing

This is a two-person project. These are our working agreements so we don't step on each other.

---

## Who Owns What

**Tabor** — software, UI/UX, NMEA parsing, LIW calculation logic, ASC, cloud/data layer, AI features  
**Caleb** — hardware wiring, load cell calibration, enclosure design, physical installation, field testing

If something crosses both domains (like a new sensor integration), open an issue and tag the other person before starting.

---

## Branch Strategy

- `main` — stable, demo-ready code only. Never push broken stuff here.
- `dev` — active development. This is where most work happens.
- Feature branches — `feature/[short-name]` for anything that takes more than a day.

```
# Start new work
git checkout dev
git pull
git checkout -b feature/section-control-fix

# Done? Open a PR into dev, not main.
```

---

## Commit Messages

Keep them short and honest. Don't overthink it.

```
# Good
fix: load cell reading drops at low weight
feat: add ASC overlap threshold setting
docs: update wiring diagram for Phase 2

# Bad
updates
stuff
wip
```

Prefixes: `feat` `fix` `docs` `hardware` `field` `refactor` `chore`

---

## Issues

Use issues to track everything — bugs, ideas, hardware notes, field test results. Don't let things live only in your head or Slack.

Label everything (see labels below). Assign it to whoever owns it.

---

## Labels

| Label | Color | Use for |
|---|---|---|
| `software` | `#0075ca` | Code, UI, logic |
| `hardware` | `#e4e669` | Wiring, enclosures, BOM |
| `field-test` | `#008672` | Real-world testing notes |
| `bug` | `#d73a4a` | Something broken |
| `enhancement` | `#a2eeef` | New feature or improvement |
| `calibration` | `#f9d0c4` | Load cell / GPS calibration |
| `phase-2` | `#bfd4f2` | Demo unit build |
| `phase-3` | `#d4c5f9` | Electron app |
| `USC` | `#ffa500` | Anything related to the USC pitch |
| `question` | `#d876e3` | Need to figure this out |
| `blocked` | `#b60205` | Waiting on something external |

---

## File Locations

- Working on UI? → `software/prototype/`
- Wiring diagram or BOM change? → `hardware/`
- Field test notes? → `field-notes/YYYY-MM-DD.md`
- Architecture decision? → `docs/`

Don't put files in the root unless they belong there (README, .gitignore, LICENSE).
