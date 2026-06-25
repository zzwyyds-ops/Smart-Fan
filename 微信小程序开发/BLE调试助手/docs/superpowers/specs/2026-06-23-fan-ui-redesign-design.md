# Fan UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the existing home, debug, and fan-control pages into a soft console-style UI inspired by the provided reference image, with large rounded panels, floating information cards, and clear hierarchy for control states.

**Architecture:** Keep the current app structure and routes, but replace the page-level visual language so all three pages feel like one product family. The home page becomes a landing panel with two large entry cards, the debug page becomes a clean diagnostic board, and the fan page becomes the most expressive control surface with status cards, control cards, and an emphasized sensor area.

**Tech Stack:** WeChat Mini Program WXML/WXSS/JavaScript, existing BLE logic, no new runtime dependencies.

---

### Task 1: Visual System

**Files:**
- Modify: `pages/home/home.wxss`
- Modify: `pages/index/index.wxss`
- Modify: `pages/fan/fan.wxss`

- [ ] Create a shared visual language based on the reference image: soft gray page background, oversized rounded containers, white floating cards, subtle shadows, and green primary actions.
- [ ] Establish consistent card radii, spacing, and typography scale across all pages.
- [ ] Define disabled and active states for controls using depth and color rather than extra explanatory text.

### Task 2: Home Page

**Files:**
- Modify: `pages/home/home.wxml`
- Modify: `pages/home/home.wxss`

- [ ] Rebuild the home page as a large rounded hero panel with two prominent entry cards.
- [ ] Keep the two entry labels readable at a glance: `调试入口` and `风扇控制`.
- [ ] Add author text in the same visual family as the other pages.

### Task 3: Debug Page

**Files:**
- Modify: `pages/index/index.wxml`
- Modify: `pages/index/index.wxss`

- [ ] Reframe the debug page as a quieter diagnostic board with clear sections for scan, connect, logs, and send controls.
- [ ] Keep the BLE workflow intact while reducing visual noise.
- [ ] Preserve the existing author footer and connection behavior.

### Task 4: Fan Page

**Files:**
- Modify: `pages/fan/fan.wxml`
- Modify: `pages/fan/fan.wxss`

- [ ] Make the fan page the most layered page: connection strip, temperature/humidity/speed cards, control cards, and a log area.
- [ ] Keep the wind-speed buttons visually disabled when smart mode is on by deepening their color and lowering contrast.
- [ ] Align the disconnect button to the right edge of the connection strip.
- [ ] Preserve the author footer.

### Task 5: Verification

**Files:**
- Check: `pages/home/home.wxml`
- Check: `pages/index/index.wxml`
- Check: `pages/fan/fan.wxml`
- Check: `pages/home/home.wxss`
- Check: `pages/index/index.wxss`
- Check: `pages/fan/fan.wxss`

- [ ] Run syntax checks on changed JavaScript files.
- [ ] Confirm the layout files contain the new rounded-panel structure and author footer on every page.
- [ ] Verify the fan page still keeps smart-mode disable behavior on speed controls.
