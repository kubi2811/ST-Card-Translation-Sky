# 🎴 SillyTavern Multitools

[Tiếng Việt](README.md) | **English** | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md)

> **A suite of 5 tools to translate & build SillyTavern character cards — runs entirely on your own machine.**
> Made by **Guillichan × Sky**.

Built for **translators** and card makers: translate cards with AI **without breaking code, regex, lorebooks, or macros** like `{{char}}` `{{user}}`.

Everything runs locally — your **API key is never sent anywhere**, no middleman server.

> 🌐 **Language & feedback:** the top **header** (on every tool) has a **UI language switcher — Tiếng Việt / English / 中文** and a **🐞 Report a bug** button (opens a shared bug-report spreadsheet). Dịch Card, Mod Card, Create Preset and the main Create Card panels are fully tri-lingual; the advanced MVU-ZOD Studio panels and Extract Card are still Vietnamese-only for now.

---

## 📦 What's inside?

Once the app is open, the left rail switches between the 5 tools. **Switch freely — anything running keeps running.**

| | Tool | What it's for |
|---|---|---|
| 🌐 | **Dịch Card** *(Translate Card)* | Translate character cards. *This is the main tool.* |
| 🃏 | **Tạo Card** *(Create Card)* | Build new cards from a story, plus Lorebook, Regex, MVU/ZOD variables, game UI. |
| 🎛️ | **Tạo Preset** *(Create Preset)* | Build / edit SillyTavern Presets & Regex Scripts by chatting with an AI. |
| 🛠️ | **Mod Card** | Modify / expand an existing card to your instructions (rewrite, deepen…). |
| 🔍 | **Trích Card** *(Extract Card)* | Read a story → automatically extract characters & Lorebook entries. |

---

## 🚀 First-time setup (once only)

### Step 1 — Install two prerequisites
- **[Node.js](https://nodejs.org/)** — get version **20 or newer** (install it like any normal program).
- **[Git](https://git-scm.com/downloads)** — default options are fine.

> Restart your computer once afterwards, just to be safe.

### Step 2 — Download the source
Open **Command Prompt** (Windows key → type `cmd` → Enter), then paste each line:

```bash
cd C:\
git clone https://github.com/kubi2811/ST-Card-Translation-Sky.git
```

### Step 3 — Run it
Go into the folder you just downloaded and **double-click `start.bat`**.

- The first run **installs libraries automatically** (takes a few minutes — leave it alone, don't close it).
- When done it opens your browser at **http://localhost:5173**.
- A few **small black console windows** will appear — those are the 3 helper tools. **Do not close them.**

> From then on, just double-click **`start.bat`**.

---

## 🔄 Updating

**Easiest:** in the app, click **"Cập nhật"** (Update) in the left rail → wait → then **fully close the app and run `start.bat` again** (a browser refresh is not enough).

**Alternative:** double-click **`update.bat`**.

<details>
<summary>⚠️ If Update fails or gets stuck — click here</summary>

<br>

Open **Command Prompt** inside the install folder and run:

```bash
git fetch origin main
git reset --hard origin/main
npm install
```

Then run `start.bat` again. This **always works**, and it **will not delete** the card you're translating, your progress, or files in `dev_data`.

</details>

---

## 📖 Translating a card

### 1️⃣ Enter your API key
Left column, **API Configuration** — the **Provider #1 (main)** box:
- Pick a **Type** (OpenAI Compatible / Anthropic / Google Gemini / Custom) and paste the **Base URL**.
- Paste your **API Key** — one per line (or comma-separated); more keys = faster, and keys auto-rotate on 429.
- Click **Load model** → pick the **main Model**; enable a **secondary Model** so short entries go to a faster model. Add **extra Providers** to run several vendors in parallel.

> 💡 Parallel lanes = Σ(keys × RPM) across **all** providers. The app **respects your RPM limits automatically** — no rate-limiting.

### 2️⃣ Load the card → the app suggests a config
Drag & drop a `.json`/`.png` into **Card Preview**, or paste a link and load. On load, the app **analyzes the card** and shows a **suggestion popup**:
- Card has an **MVU variable framework** / heavy UI script → suggests **⚡ Light**; **big** card → **🚀 Turbo**; **small** card → **📖 Full**.
- Click **"✅ Use suggested config"** (one-tap apply) or **"Keep current settings"**.

> A card you were mid-translating (reopened) **restores its progress** instead of asking again.

### 3️⃣ Choose a translate mode (3 presets — the ★ is the one recommended for this card)

| Button | Translates | When |
|---|---|---|
| **⚡ Light** | Only what the player **sees** (keywords, greeting, card / Lorebook entry names, display regex). Card internals + MVU vars stay in source | Cards with heavy MVU / game UI — much faster; the AI still reads & replies in your language |
| **📖 Full** | Everything | Normal cards, full localization |
| **🚀 Turbo** | Full + bundles many short entries into one call | Big / many-entry cards, maximum speed |

### 4️⃣ Click **Translate**
Before translating, the app handles automatically:
- **📖 Auto name glossary (Phase 0):** scans recurring character / term names, translates them in **one call** → shared by all lanes (no more one character with different names). Cards rich in xianxia/wuxia terms also **auto-load a standard term pack**.
- **♻ Reuse old translations:** if you translated an earlier version of the card, **unchanged content** is carried straight over (♻ badge); only new parts get translated.

While running: watch the **lane panel** (which model translates which entry, RPM, **🧮 real in/out tokens** per model + total). **Pause / Stop** anytime; progress **auto-saves** and survives closing the tab.

### 5️⃣ Acceptance & export
- **🩺 Full Check** (in the Export box): one button runs **3 checkers** (card health + deep macro/bracket/HTML/JSON check + diff against the original card) → a **PASS / FAIL** verdict; click any issue to **jump straight to its field**.
- **👁 View as SillyTavern** (button in Card Preview): preview the greeting after translation **exactly like in ST** — see ✨ below.
- **Export** `.json` / `.png` (re-embedded into the original card image) → drop it straight into SillyTavern.

> ### ✅ Suggested workflow for translators
> **Translate → 🩺 Full Check (catch static issues) → 👁 View as SillyTavern + 🧪 + ⇄ Compare (catch runtime issues) → fix the failing field → Export.**

---

## ✨ What makes this good for translators

### 🔪 "Surgical" translation — your card doesn't break
The app **only translates the prose**, leaving HTML/CSS/JS, regex, URLs, variables and macros like `{{char}}` `{{user}}` completely untouched — exactly what usually breaks cards when translating by hand or with a plain AI. A **repair guard** auto-fixes code if stray characters get injected.

### 👁 View as SillyTavern — see the UI exactly like playing ⭐
The **👁 View as SillyTavern** button in **Card Preview**. Renders the greeting after applying the card's macros + display regex, inside a **safe isolated iframe** (scripts off by default):
- **🧪 Run scripts + test data:** emulates the real TavernHelper / MVU environment (like the actual JS-Slash-Runner extension) → **script-driven status bars / game UIs fill in**, so you see the UI exactly like in ST without importing. **Script errors show instantly + trace back to the exact regex/field + a ↪ jump-to-field button** to fix the translation.
- **🎲 AI test data:** for unplayed cards (all-default vars) or cards with **no `[initvar]`** → call AI to fill **realistic sample values** (AI only changes values, keeps variable names) → status bars show real numbers.
- **⇄ Compare:** Original | Translated run **side by side** — both erroring = a **pre-existing card bug**; only Translated erroring = a bug **caused by translation**.

### ⚡ Many lanes + 🧮 real token counting
Multiple keys × multiple providers = many requests in parallel; a finished lane grabs the next entry immediately, still within your **RPM limits** (no 429). The panel + end-of-run log show **real in/out tokens** read from the API — you know exactly how much you burned (great with shared keys).

### ♻ Translating a card update — only the changes ⭐
Author updated the original? No full re-translate. **Two ways:**
- **Automatic:** load the new version; the app scans your old caches, carries over **unchanged content** (♻ badge), leaving only the new parts.
- **Manual — 🔀 Compare Cards** (button above Card Preview): load 3 files **Card Raw** (old original), **Card Translated** (your old translation), **Card Final** (new original) → **Smart Merge** → preview (♻ green = reused, ✏️ amber = to translate) → **Send to Translate Card** to translate only the new parts. You can also view all 3 versions side by side, edit in place, and filter to "only show differences".

### 🧠 Consistency
- **📖 Auto name glossary** + a **📚 built-in xianxia/wuxia term pack** (92 terms, auto-loaded when the card matches) — names & terms consistent across the whole card.
- **Glossary** — force names/terms to be translated exactly how you want (your entries always win).
- **Translation memory** — identical sentences get identical translations.
- **MVU / EJS sync** — variable names in code and in the lorebook always stay in sync.

---

## 🧰 The other 4 tools

<details>
<summary><b>🃏 Tạo Card (Create Card)</b> — build a card from scratch</summary>

<br>

Turn a story into a card, mass-generate Lorebook entries, a Regex lab, an EJS Studio, and the **MVUZOD Studio** (design variables, initial values, update rules, and **Game UI** — chat with an AI that writes your game interface and *proves the regex actually matches* before handing it over).

</details>

<details>
<summary><b>🎛️ Tạo Preset (Create Preset)</b> — Presets & Regex</summary>

<br>

Chat with an AI to design **Preset JSON** and **Regex Script JSON** for SillyTavern, preview, then download.

</details>

<details>
<summary><b>🛠️ Mod Card</b> — modify / expand an existing card</summary>

<br>

Load a card, write your instructions (e.g. *"change the setting"*, *"add 3 more sections"*), and the AI analyses then rewrites section by section. Includes an **Expand / deep-dive mode**, a **before–after diff table**, and oversized entries are **split into parts automatically** so nothing gets truncated.

</details>

<details>
<summary><b>🔍 Trích Card (Extract Card)</b> — mine a story for characters</summary>

<br>

Paste in a long story; the app chunks and scans it, extracts **characters + Lorebook entries**, and exports a ready-to-use file.

</details>

---

## ❓ Common problems

**The Update button errors out / gets stuck**
→ See [Updating](#-updating) above and use the three manual commands.

**The app says `Failed to resolve import ...`**
→ A new version added a library. Fully close the app and run **`start.bat`** again (it installs automatically). Still stuck? Run `npm install` in the install folder.

**The app freezes for a few seconds after loading a card**
→ That card has very heavy Regex Scripts (hundreds of KB). It's normal — just wait. If you don't need to translate the scripts, untick the **Regex** group in step 3.

**Can't connect to the API / CORS error**
→ Double-check the Base URL and Key, try enabling **CORS Proxy**, or hit **Test Connection** to see the exact error.

**Gemini returns 524 / times out when expanding a huge entry**
→ One request ran too long and the proxy timed out. Use **Expand mode** on the whole section (the app splits it into parts), or pick a smaller block to deep-dive.

**What are those little black windows from `start.bat`?**
→ The 3 helper tools (Create Card / Create Preset / Mod Card). **Don't close them** or those tools won't load.

---

## 🔒 Privacy

- Runs **100% on your machine**. Your API key lives in your browser and is **never sent to any server of ours**.
- Your cards and translations stay on your machine too.

---

## 🛠 For developers

Vite + React + TypeScript · Zustand · Next.js (Mod Card) · Vitest.

```bash
npm install        # install dependencies
npm run dev        # run the Hub (port 5173)
npm run test:run   # run tests
npm run build      # production build
```

Ports: Hub/Translate `5173` · Create Card `5174` · Create Preset `5175` · Mod Card `5176` · Extract Card (static file, no port).

Changelog: see [CHANGELOG.md](CHANGELOG.md).

---

## 📝 License

MIT
