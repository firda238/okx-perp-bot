# Quant Studio UI / Figma Audit Checklist

Updated: 2026-06-06 Asia/Shanghai

## Verification State

Local UI verification is available. A Figma baseline file has been created, but
Figma page capture is not complete yet because the current Figma Starter plan
hit the MCP tool-call limit during capture. A direct screenshot asset upload was
also attempted and blocked by the same Figma MCP limit.

Figma baseline file:

- `OKX Quant Studio Live UI Baseline`
- `https://www.figma.com/design/7tL766C5V1xj3h7nQDpfHr`

Latest local evidence:

- UI smoke command: `cd quant-studio-ui && npm run smoke:ui`
- Default screenshot artifact: `output/playwright/quant-live-smoke.png`
- Prior screenshot artifact: `.cache/quant-live-progress.png`

## Screens That Need Figma Comparison

These screens are implemented locally and should be matched against Figma once a
design source is provided:

1. Dashboard workspace
2. Market workspace
3. Strategy workspace
4. Backtest workspace
5. Risk workspace
6. Live execution workspace
7. Data workspace
8. Settings workspace
9. Top navigation and notification center
10. Sidebar collapsed and expanded states

## Live Workspace Figma Requirements

The live execution workspace is the highest-priority screen for live testing.
Figma comparison should verify:

- Connector health summary is visible above detailed JSON panels.
- Private interface lock is visually obvious.
- OKX read-only diagnostics have a distinct pass/fail state.
- Canary notional and live notional controls are visible and not crowded.
- Real submit and real cancel actions look dangerous and remain gated.
- Query, cancel, and fill ledger actions are visually separate.
- Execution lifecycle states have stable labels:
  - preview
  - blocked
  - submitted
  - open
  - cancel requested
  - canceled
  - filled
  - duplicate
  - timeout / cancel due
- JSON evidence panels remain readable at desktop width.
- Empty states render the same structural headings as populated states.

## Smoke-Covered UI Text

The current UI smoke verifies that these live-workspace labels are present:

- `实盘动作队列`
- `提交确认控制台`
- `Connector Preview JSON`
- `签名预览`
- `私有自检`
- `只读回执`
- `单笔名义上限`
- `Canary试运行`
- `Canary小额试运行预览`
- `确认短语锁测试`
- `Canary锁测试`
- `刷新执行账本`
- `账本详情`
- `订单生命周期证据`
- `生命周期处置`
- `ADAPTER PREVIEW`
- `记录查询回执`
- `查询OKX状态`
- `记录撤单回执`
- `提交真实撤单`
- `记录成交回执`
- `Payload / Gate JSON`

## Figma Evidence Needed

To close the UI@Figma item, one of these must happen:

- A node-specific Figma URL for the Quant Studio screen.
- A Figma file URL plus the target node ID.
- Continue capture or asset upload into the new baseline file after the Figma
  MCP rate limit resets or the plan is upgraded.
- Manually import `output/playwright/quant-live-smoke.png` into the new baseline
  file and use it as the review baseline while MCP capture is rate-limited.

## Acceptance Criteria

UI@Figma is complete only when all are true:

1. The target Figma node is identified.
2. The local UI screenshot is captured from the current code.
3. The Figma screenshot is captured from the identified node.
4. Layout, text hierarchy, colors, spacing, component states, and live-action
   affordances are compared.
5. Any visual differences are either fixed in code or explicitly accepted.
6. `npm run build` and `npm run smoke:ui` pass after UI fixes.
