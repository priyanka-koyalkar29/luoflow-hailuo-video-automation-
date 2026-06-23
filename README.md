# LuoFlow – Hailuo Video Automation

A workflow automation Chrome extension built during my internship to automate AI video generation pipelines on [Hailuo AI](https://hailuoai.video) from Excel storyboards. Upload a spreadsheet, review shots, attach reference images, and the extension automates browser interactions to queue, submit, and collect generated video URLs in real-time.

---

## Background

This project originated during my internship at OAKS , where I worked on automating Hailuo AI video generation workflows. 

The repository here represents my maintained and enhanced version, including a complete glassmorphic dark-theme UI overhaul, interactive execution log monitoring, live queue metrics, error recovery features, and advanced sheet template generation.

---

## Key Features

- **Excel Storyboard Ingest** — Drag-and-drop or copy-paste `.xlsx` files. Smart matching columns (e.g. `shot`, `visual description`, `prompt`, `narration`).
- **Interactive Dashboard** — Toggle between **Timeline Editor** (detailed edits per shot) and a visual **Storyboard Grid** (quick overview of sequence).
- **Template Downloader** — Programmatically exports structured Excel templates so users have the exact format.
- **Reference Image Crop** — Center-crops attached reference images to cinematic 16:9 ratio before background serializing.
- **Real-Time Metrics** — Tracks Total Shots, Completed, Failed, Success Rate, Queue Status, and dynamically calculates Estimated Queue Runtime based on the chosen model.
- **Developer Log Terminal** — Live console display showing precise automation steps (tab updates, script injection, file uploads). Includes log file exports.
- **Error Recovery** — Support for manually retrying failed shots, pausing/resuming queue executions, and custom timeout boundaries.

---

## Architecture

LuoFlow is structured as an MV3 Chrome Extension with multi-layer browser context isolation:

```
Popup UI (React/Vite)
       │
       ▼ (Long-lived port: 'generation')
Background Service Worker (background.ts)
       │
       ├─► (chrome.tabs/scripting) ──► Direct DOM Automation (clicks, text fills)
       │
       ▼ (chrome.runtime.sendMessage)
Content Script (content.ts)
       │
       ▼ (window.postMessage)
Injected Main World Script (inject.ts)
       │
       ▼ (Monitors XHR/Fetch API calls)
Hailuo AI Web Application
```



---

## Technical Challenges & Engineering Solutions

### 1. Reliable Browser Automation
Handling dynamic page updates and automated interactions within the Hailuo AI interface.
* **Solution:** LuoFlow targets the Slate element in the `MAIN` execution world (rather than the default extension context) to work around framework constraints. It triggers a simulated select-all text command (`document.execCommand('selectAll')`) followed by a programmatically created `ClipboardEvent('paste')` carrying the prompt text, notifying Slate's state machine of the text insertion.

### 2. Base64 Serialization & Sandbox Communication
Chrome extension popups communicate with the background worker via JSON-serializable message ports. Binary `File` objects from image uploads cannot be directly serialized.
* **Solution:** Implemented canvas-based center-cropping on image uploads in the popup context, converting attachments to 16:9 JPEG base64 strings (`data:image/jpeg;base64,...`). The background worker receives this string, rebuilds a binary array (`Uint8Array`), creates a synthetic `File` object using a `DataTransfer` container, and simulates form inputs to execute asynchronous uploads.

### 3. API Response Interception
Detecting when a rendering video finishes requires polling or socket watching. Checking the page DOM repeatedly is slow and error-prone.
* **Solution:** Built a lightweight injection script (`inject.ts`) loaded in the page's `MAIN` execution world. It wraps `window.fetch` and checks if incoming requests contain `hailuoai` URLs. When a GET request containing the feed data completes, the script clones the JSON response and relays it up to the content script via `window.postMessage`. The background script reads the payload, matches the unique `batchID`, and notifies the popup UI when the video URL appears.

---

## Installation & Setup

### Prerequisites

- **Node.js** 18+
- **Google Chrome** (or any Chromium browser)
- A logged-in [Hailuo AI](https://hailuoai.video) account

### 1. Install Dependencies
```bash
npm install
```

### 2. Build the Extension
```bash
npm run build
```
*(This bundles React, compiles TypeScript, and copies the `manifest.json` into the `dist/` directory.)*

### 3. Load unpacked in Chrome
1. Open Chrome and go to `chrome://extensions`.
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked** (top-left).
4. Select the `dist/` folder inside the project directory.

The extension icon will appear in your toolbar. Click it to open the application in a full tab.

---

## Storyboard Excel Format

The Excel parser matches columns dynamically using case-insensitive substrings. Minimum column headers:
* **Prompt** (or *Video Prompt* / *Hailuo Prompt*): The prompt text.
* **Visual Description** (or *Visual*): General visuals.
* **Shot Number** (optional): Used for indexing.
* **Narration** / **Text on Screen** / **Asset Type** (optional): Informational metadata fields.

*You can download a pre-formatted template from the LuoFlow upload page.*
