# Fan Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a home page with two entries, keep the existing BLE debug tool, and add a BLE fan-control page for STM32 fan commands and telemetry.

**Architecture:** The existing debug page remains at `pages/index/index`. A new `pages/home/home` becomes the first page. A new `pages/fan/fan` owns fan UI and BLE connection flow. Shared pure fan logic lives in `utils/fanLogic.js` and is tested with a Node assert test.

**Tech Stack:** WeChat Mini Program WXML/WXSS/JavaScript, BLE APIs, Node assert for pure logic checks.

---

### Task 1: Fan Logic

**Files:**
- Create: `utils/fanLogic.js`
- Create: `tests/fanLogic.test.js`

- [ ] Write tests for command bytes, telemetry parsing, and smart speed selection.
- [ ] Run the test and confirm it fails before implementation.
- [ ] Implement pure fan logic helpers.
- [ ] Run the test again and confirm it passes.

### Task 2: Page Routing

**Files:**
- Modify: `app.json`
- Create: `pages/home/home.*`
- Keep: `pages/index/index.*`

- [ ] Set `pages/home/home` as the first page.
- [ ] Add two home entries: debug tool and fan control.
- [ ] Navigate to the existing debug page and new fan page.

### Task 3: Fan Control Page

**Files:**
- Create: `pages/fan/fan.js`
- Create: `pages/fan/fan.wxml`
- Create: `pages/fan/fan.wxss`
- Create: `pages/fan/fan.json`

- [ ] Add BLE scan/connect/disconnect.
- [ ] Add power toggle commands `00` and `01`.
- [ ] Add mode commands `02`, `03`, `04`.
- [ ] Add speed commands `05` through `09`.
- [ ] Parse STM32 text telemetry into temperature, humidity, and speed.
- [ ] Add smart mode that sends an automatic speed command when temperature/humidity changes enough to require a new level.

### Task 4: Verification

**Files:**
- Check: `pages/fan/fan.js`
- Check: `pages/home/home.wxml`
- Check: `app.json`

- [ ] Run the pure logic test.
- [ ] Run JS syntax checks on changed JavaScript files.
- [ ] Confirm route declarations and page files exist.
