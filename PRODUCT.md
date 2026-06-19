# Product

## Register

product

## Users

Single lottery agency team: one primary operator (owner or manager) plus subordinate data-entry staff (operators) and read-only viewers. They use this every working day, multiple sessions per day, seated at a desk or occasionally on a tablet. They are numerically fluent, familiar with Thai lottery workflows (งวด, โพย, ตัดส่ง, เลขอั้น), and expect a tool that stays out of their way. Mobile use is secondary — managers checking summaries or verifying totals, not full bet-entry workflows.

## Product Purpose

AuraX is an internal lottery operations management system (ระบบรับแทงหวย). It enables the team to manage lottery draw rounds, accept and record bet slips (โพย), set per-number limits and cut rates (เลขอั้น / อัตราเก็บ), forward exposure to upstream dealers (ตัดส่ง), and review profit/loss summaries per round. Success means: zero missed bets, accurate exposure numbers before draw time, and fast end-of-round reconciliation.

## Brand Personality

Calm, precise, trustworthy. The interface should feel like a well-maintained accounting ledger — no visual noise, no urgency theater. Numbers are the product; the UI is the frame. Think terminal trading tools and professional finance dashboards: dense but scannable, quiet but authoritative.

## Anti-references

- Casino / gambling aesthetic — no dark felt-green, gold accents, or neon. This is a ledger, not a slot machine.
- Loud SaaS marketing dashboards — no hero metrics, no gradient text, no color-as-decoration. Color signals state, not enthusiasm.
- Dated enterprise software — no Windows-era crowded gray forms. Density is fine; visual poverty is not.
- Over-animated or flashy — motion only where it conveys state change. The tool should disappear into the task.

## Design Principles

1. **Numbers first.** Every screen layout prioritizes the data itself — tabular alignment, lining numerals, tight spacing. Chrome earns its presence by making numbers easier to read.
2. **State is the only color.** Color carries meaning: green = profit, red = loss/risk, amber = warning, blue = active/selected. Never decorative.
3. **Density without crowding.** The operators process many rows per session. Pack information tightly, but preserve scannable rhythm with consistent vertical spacing and zebra rows.
4. **Quiet confidence.** Animations should feel like a well-made physical object — not bouncy, not dramatic. 150–220 ms ease-out. Reduced motion respected unconditionally.
5. **Mobile is a viewport, not a persona.** The primary surface is desktop/laptop. Tablet and phone views must not break, but don't sacrifice desktop density for them.

## Accessibility & Inclusion

WCAG AA as the floor. Particular attention to:
- Contrast: body text on the light `#f5f7fb` canvas must hit ≥ 4.5:1 at all times, including table cells and muted secondary text.
- Touch targets: ≥ 44 × 44 px for all interactive elements — tablet operators tap with fingers.
- Thai script: IBM Plex Sans Thai chosen deliberately; preserve it. Line-height ≥ 1.5 for Thai prose.
- Color alone never conveys meaning — profit/loss, risk levels, and status must have a secondary cue (label, icon, or shape).
