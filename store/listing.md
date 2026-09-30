# बाघचाल / Baghchal — Google Play listing (ready to paste, M5)

Char limits: title ≤ 30 · short description ≤ 80 · full description ≤ 4000.
Default language Nepali (locale `ne-NP`), English translation below.

---

## Title

| lang | text | len |
|------|------|-----|
| ne | `बाघचाल` | 7 |
| en | `बाघचाल — Tiger & Goats` | 23 |
| en (alt) | `Baghchal: Tiger and Goats` | 25 |

## Short description

| lang | text | len |
|------|------|-----|
| ne | `नेपाली परम्परागत बोर्ड खेल — बाघ रबाख्राको रणनीतिक लडाइँ।` | 63 |
| en | `Classic Nepali board game: trap four tigers with twenty goats.` | 64 |

## Full description — ne

चार बाघ। वीस बाख्रा। पुरानो बुद्धिको एउटा लडाइँ।

बाघचाल नेपाली परम्परागत बोर्ड खेल हो, जहाँ चार बाघहरू बोर्डमा भाग्छन् र वीस बाख्राहरू मिलेर तिनलाई घेर्छन्। बाघ र बाख्राको यो असममित रणनीतिक खेल सयौं वर्षदेखि खेलिँदै आएको छ।

खेलने तरिका:
• चार बाघ कोनामा बस्छन्; बाख्रा एक-एक राखिन्छ।
• बाघले बाख्रा ओल्दै खान्छ; बाख्राले केही खाँदैन — उसले बाघलाई घेर्छ।
• पाँच बाख्रा खाएपछि बाघ जित्छ। सबै बाघ चल्न नसके बाख्रा जित्छ।
• तीन पटक दोहोरिए खेल बराबरी हुन्छ।

विशेषताहरू:
• तीन स्तरको कृत्रिम बुद्धिमत्तासँग AI विरुद्ध खेल — सजिलोदेखि गाह्रोसम्म।
• एउटै मोबाइलमा दुई जनाका लागि स्थानीय (Pass & Play) मोड।
• पूर्ण नेपाली र अंग्रेजी इन्टरफेस — एक ट्यापमा बदल्न सकिन्छ।
• पछाडि फेर्ने (Undo), चाल-इतिहास, अन्तिम चाल, पज मेनु।
• पूर्ण अफलाइन — विज्ञापन, खरिद र इन्टरनेट अनुमति बिना।
• कुनै पनि तथ्याङ्क सङ्कलन हुँदैन।

Rules quick-ref: tigers = बाघ (4, corners) · goats = बाख्रा (20, placement first) · capture = ओल्ने (jump) · block = घेर्ने.

## Full description — en

Four tigers. Twenty goats. An ancient battle of wits.

Baghchal is the classic Nepali board game of tigers and goats — an asymmetric strategy contest where four tigers roam the board while twenty goats work together to trap them. A game played across South Asia for generations, now on your phone.

How to play:
• Tigers start on the four corners; goats are placed one at a time.
• Tigers capture by jumping over a goat; goats capture nothing — they win by blocking.
• Tigers win after capturing five goats. Goats win by leaving every tiger with no legal move.
• Threefold repetition is a draw.

Features:
• Play against the AI at three difficulties — from relaxed Easy to a thinking Hard.
• Pass & Play local multiplayer on one device.
• Full Nepali and English interface — switch with one tap.
• Undo, move history, last-move indicator, pause menu.
• Fully offline — no ads, no purchases, no account, no internet permission.
• No data is collected. The game runs entirely on your device.

Classic rules, fair play, faithful board. खेल्न लगनुहोस् — बाघचाल!

---

## Assets checklist (M5 upload)

| asset | file | size |
|-------|------|------|
| App icon 512×512 | `resources/icon-512.png` | 512×512 ✓ |
| Feature graphic 1024×500 | `resources/feature-graphic.png` | 1024×500 ✓ |
| Phone screenshots (5) | `store/screenshots/01..05-*.png` | 1080×2400 ✓ |

Screenshots order: 01 menu · 02 side + difficulty · 03 mid-game · 04 pause + history · 05 win overlay.

## Console settings (M5)

- Package: `np.baghchal.game` (locked) · version 1.0 (versionCode 1)
- **Versioning: versionCode 1 (r1) is spent on first upload — before every later upload, bump `versionCode` in `android/app/build.gradle` (→ r2, r3…); `release.ps1` derives artifact names automatically (`baghchal-1.0-r2-release.*`). Bump `versionName` only per meaningful update.**
- Category: Games › Board · Tags: strategy, offline, nepali
- Content rating: complete questionnaire (violence None, multiplayer None, ads None, IAP None)
- Data safety: no data collected — the app has zero network use and zero permissions
- Monetization: Free, no ads, no in-app purchases
- **Privacy policy URL: required by Play Console — host a one-page policy before submission** (state: no collection, no network, no third parties)
- Play App Signing: enroll **keeping `baghchal-release.jks` as the app-signing key** (see backup README) so direct-share APKs and Play installs stay mutually updatable
- Contact email: fill in at M5
