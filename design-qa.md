**Source Visual Truth**
- Popup mock: `/Users/kazumasa/.codex/generated_images/019eac2a-0f2b-7151-b887-101b66b3031d/ig_05d8458810b4c77b016a2804ea86908191ad87076a6a4d05df.png`
- Side Panel mock: `/Users/kazumasa/.codex/generated_images/019eac2a-0f2b-7151-b887-101b66b3031d/ig_05d8458810b4c77b016a28056ce63c8191a855f820d97f6ed5.png`

**Implementation Evidence**
- Popup viewport screenshot: `/private/tmp/fudosan-tanka-preview/popup-viewport.png`
- Side Panel viewport screenshot: `/private/tmp/fudosan-tanka-preview/sidepanel-viewport.png`
- Popup full-view comparison: `/private/tmp/fudosan-tanka-preview/popup-comparison.png`
- Side Panel full-view comparison: `/private/tmp/fudosan-tanka-preview/sidepanel-comparison.png`

**Viewport**
- Popup: 420 x 620
- Side Panel: 520 x 900

**State**
- Mocked `chrome.storage.local` with four realistic favorite properties, loan settings at 0.8 percent / 35 years / 0万円 down payment, price history, repair-risk labels, memos, and viewing checklist state.

**Focused Region Comparison Evidence**
- Popup: header/tabs, summary metrics, loan settings, first candidate row, bottom action bar.
- Side Panel: header/search, active comparison tab, summary strip, comparison table, selected-property detail, bottom actions.

**Findings**
- No actionable P0/P1/P2 findings.

**Required Fidelity Surfaces**
- Fonts and typography: Japanese system sans-serif is consistent with the existing extension and matches the mock's product UI hierarchy closely enough. Numeric hierarchy is strong and readable.
- Spacing and layout rhythm: Popup and Side Panel both use grouped surfaces, row separators, compact section gaps, and stable scroll regions. Footer actions no longer overlap scroll content.
- Colors and visual tokens: The implementation follows the mock's white base, deep ink, blue navigation/accent, green opportunity state, amber caution, and red risk states.
- Image quality and asset fidelity: Existing extension data does not store property thumbnails, so the popup implementation intentionally uses text-first candidate rows instead of generated or placeholder images. The existing extension icon asset is reused.
- Copy and content: Japanese labels map to the intended experience: 候補, 比較, 内見, 価格ウォッチ, 坪単価, 月額概算, 修繕診断, CSV出力, Side Panelで比較.

**Patches Made Since Previous QA Pass**
- Changed popup to a flex layout with a dedicated scroll area so the action bar does not cover content.
- Changed Side Panel to a flex layout with a dedicated scroll area so bottom actions do not cover selected-property content.
- Reduced initial Side Panel comparison from four columns to three for readability at 520px width.

**Follow-up Polish**
- Add real property thumbnails later if `content.js` starts saving image URLs in favorite data.
- Replace text actions with a local icon set if the project adopts one.

final result: passed
