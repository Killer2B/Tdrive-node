# INTEGRATION_AUDIT.md — جرد الربط بين الواجهة والباك إند

> **المشروع:** `tdrive/` — سحابة شخصية (Fastify + SQLite + تخزين Telegram/محلّي) وواجهة React/Vite (تصميم Vaulta) في `web/`.
> **الهدف:** تحويل كل عنصر معروض إلى بيانات حقيقية من القاعدة عبر الـ API. هذا الملف يرصد الحالة **قبل** العمل، ويُحدَّث إلى ✅ بعد الربط (المرحلة 5).
>
> **مفتاح الحالة:** ✅ مربوط حقيقي · ⚠️ مربوط جزئيًّا/شكليّ · ❌ وهمي بالكامل · 🆕 يحتاج endpoint جديد.

## 0) ملخّص المنهجية
قُرئت كامل ملفّات `web/src/**` و`src/**` ومخطّط القاعدة (`src/db/migrations.ts`) وقاعدة البيانات الفعلية
(`data/tdrive.sqlite`: مستخدم واحد، ملف حقيقي واحد، مشاركة واحدة، 5 جلسات). المسارات الوظيفيّة الأساسية
(المصادقة، الملفّات، الرفع المجزّأ، التحميل من رابط، البثّ، السلّة، البحث، المشاركات، الجلسات، الإعدادات،
النظام، SSE) **موصولة فعلًا**. أمّا لوحات «التحليلات» و«الأمان» و«المشاركات» و«النظرة العامّة» فتحوي
كمًّا كبيرًا من البيانات الوهمية/الزخرفية. الجدول أدناه يرصد كل عنصر.

---

## 1) طبقة البيانات الوهمية المركزية
| العنصر | الملف | الحالة | التفصيل |
|---|---|---|---|
| `mockData.ts` بالكامل | `web/src/data/mockData.ts` | ❌ | ثوابت صور خارجية (`USER_AVATAR`, `VAULT_REPLICA_IMAGE`, `VIDEO_PREVIEW_IMG`, صور مستثمرين) + `INITIAL_FILES/TRASH/SHARED_VAULTS/EXTERNAL_LINKS/TRANSFERS/CLIENT_NODES`. المستخدَم فعليًّا: `INITIAL_SHARED_VAULTS` و`USER_AVATAR` و`VAULT_REPLICA_IMAGE` و`VIDEO_PREVIEW_IMG`. الباقي ميّت. **الإجراء:** حذف الملف كلّه بعد استبدال المستوردات. |

---

## 2) App.tsx (جذر التطبيق)
| العنصر | الحالة | endpoint | التفصيل / الإجراء |
|---|---|---|---|
| قائمة الملفّات/السلّة/الاستخدام | ✅ | `GET /api/files` | مربوطة. |
| التحويلات/التقدّم (SSE) | ✅ | `GET /api/events`, `/api/downloads/jobs` | مربوطة. |
| المشاركات/الجلسات | ✅ | `/api/shares`, `/api/sessions` | مربوطة. |
| `sharedVaults` | ❌ | 🆕 `GET /api/vaults` | ثابت من `INITIAL_SHARED_VAULTS`. |
| `storageTotalTB` | ⚠️ | 🆕 حصة في الإعدادات | محسوب بـ `Math.max(5, ceil(used*1.25))` — رقم ملفَّق. يصبح حصة حقيقية من الإعدادات. |
| `handleZeroOut` | ❌ | 🆕 `POST /api/security/wipe-peers` | يعدّل الحالة محليًّا فقط. |
| `onRestoreVersion` | ❌ | — | `addToast` فقط (لا نظام إصدارات). يُزال العرض الوهمي. |
| `onExportAuditCsv` / `onExportAuditLog` | ❌ | 🆕 `GET /api/activity` | `addToast` فقط. يصبح تصدير CSV من سجلّ نشاط حقيقي. |
| `onConvertTiffs` / `onRecalculateQuotas` | ❌ | 🆕 `/api/stats/*` | `addToast`/`setTimeout`. |
| `onFilterClick` | ❌ | — | `addToast` فقط. يُربط بفلترة فعلية أو يُزال. |

---

## 3) OverviewView.tsx
| العنصر | الحالة | endpoint | التفصيل / الإجراء |
|---|---|---|---|
| `activeProgress` (setInterval) | ❌ | — | تقدّم وهميّ متحرّك. يُحذف ويُستبدل بتحويلات SSE الحقيقية. |
| شريط «Active Transfers» (3 عناصر ثابتة) | ❌ | `/api/downloads/jobs` + SSE | يتجاهل `transfers` الحقيقية ويعرض 3 عناصر ثابتة. يُربط بالبيانات الحقيقية. |
| أزرار Pause/Abort | ❌ | `POST /api/downloads/jobs/:id/cancel` | تعمل على حالة محاكاة. تُربط بالإلغاء الحقيقيّ. |
| `pinnedVaults` (4 عناصر ثابتة) | ❌ | 🆕 `/api/stats/overview` | مصفوفة ثابتة. تُربط بالملفّات المثبّتة (`pinned`) الحقيقية. |
| «Active Files 14,289 / +412 w/w» | ❌ | 🆕 `/api/stats/overview` | رقم ثابت. يصبح عدّ ملفّات حقيقيّ. |
| «Encrypted Bandwidth 482 GB/mo / Limit 2 TB» | ❌ | 🆕 `/api/stats/overview` | ثابت. يصبح مجموع تنزيلات المشاركات الحقيقيّ. |
| «Collaborators 38» + صور | ❌ | 🆕 `/api/stats/overview` | ثابت. يصبح عدد المشاركات/الوصول الحقيقيّ. |
| «Zero-Knowledge 100% / 0 Key Leaks» | ❌ | 🆕 `/api/stats/overview` | ثابت. يصبح نسبة التقطيع/حالة الـ backend الحقيقية. |
| Storage Breakdown (61.7%/18.8%/… + «2.1 TB» إلخ، «68%») | ❌ | 🆕 `/api/stats/overview` | نسب وأرقام ثابتة. تُحسب من `SUM(size) GROUP BY type`. |
| زر «Request Files» | ❌ | — | `onClick={() => undefined}`. يُربط (فتح الرفع) أو يُزال. |
| بانر «Decentralized Sharding» + `VAULT_REPLICA_IMAGE` | ❌ | — | صورة خارجية + نصّ زخرفيّ. تُستبدل بعنصر CSS وحالة تخزين حقيقية. |
| «Sync Integrity: 14 ms / YubiHSM 2 / 29 Days» | ❌ | 🆕 `/api/stats/overview` | ثابت. يصبح حالة حقيقية (backend، نافذة السلّة الفعلية). |

---

## 4) SharedVaultsView.tsx
| العنصر | الحالة | endpoint | التفصيل / الإجراء |
|---|---|---|---|
| بطاقات «Gated Collaboration Spaces» (`vaults`) | ❌ | 🆕 `GET /api/vaults` | من `INITIAL_SHARED_VAULTS`. تُربط بالمجلّدات الحقيقية (كمساحات تعاون). |
| «Active Sessions 142 / Audit Sealed 100% E2EE» | ❌ | 🆕 `/api/vaults` meta | ثابت. يصبح عدّ جلسات حقيقيّ. |
| Sparkline لكل بطاقة | ❌ | — | SVG ثابت. يُحذف أو يُغذّى بنشاط حقيقيّ. |
| تبويب «File Drop Portals (3)» | ❌ | — | عدد ثابت بلا محتوى. يُزال العدد الوهميّ. |
| تبويب «Security Audit Log» | ❌ | 🆕 `GET /api/activity` | لا محتوى. يُملأ بسجلّ نشاط حقيقيّ. |
| جدول «External Links» | ✅ | `GET /api/shares` | مربوط (أسماء، حصص، تنزيلات، انتهاء من صفوف المشاركة الحقيقية). |
| بحث/فلترة الجدول | ✅ | عميل | يفلتر البيانات الحقيقية. |
| زر Revoke | ✅ | `POST /api/shares/:id/revoke` | مربوط. |
| «Audit All Outbound Nodes →» | ❌ | — | `onClick={() => undefined}`. يُزال/يُربط. |
| `onExportAuditCsv` | ❌ | 🆕 `/api/activity` | تصدير CSV حقيقيّ. |

---

## 5) SecurityAuditView.tsx
| العنصر | الحالة | endpoint | التفصيل / الإجراء |
|---|---|---|---|
| `handleRecalc` (setTimeout) | ❌ | 🆕 `/api/stats/security` | محاكاة. تصبح إعادة حساب حقيقية. |
| قرص السعة (center) | ⚠️ | `/api/storage` | المركز حقيقيّ، لكن إزاحات الحلقات ثابتة والتقسيم «1.64 TB…» وهميّ. |
| «840 GB Deduplicated / Ratio 1.24x / 16.8%» | ❌ | 🆕 `/api/stats/security` | ثابت. يصبح إزالة تكرار حقيقية (`GROUP BY sha256`). |
| مخطّط التوقّع 6 أشهر + «Nov '24 1.8 TB…» | ❌ | 🆕 `/api/stats/security` | SVG ثابت. يصبح نموّ حقيقيّ من `created_at` شهريًّا. |
| «Net Ingest +28.4 GB/day / Runway ~54 Days / 4.50 TB» | ❌ | 🆕 `/api/stats/security` | ثابت. يُحسب من المعدّل الحقيقيّ. |
| بطاقات التوصيات (14 نسخة مكرّرة/324 عنصر سلّة/96 TIFF/«67.4 GB») | ❌ | 🆕 `/api/stats/security` | أرقام ثابتة. تصبح توصيات مُولّدة من بيانات حقيقية (تكرار، سلّة، ملفّات كبيرة). |
| «Review & Purge» | ❌ | 🆕 `/api/stats/dedup` + purge | يفتح مودال وهميّ. |
| «Empty Stale Trash» | ⚠️ | `POST /api/files/trash/empty` | يُفرغ كل السلّة (مربوط) لكن النصّ «>30 يوم/324» وهميّ. |
| «Convert to AVIF» | ❌ | — | لا تحويل. تُستبدل البطاقة بتوصية حقيقية (ملفّات كبيرة). |
| «Cryptographic Security Fabric» (HSM/Kyber/YubiKey/Reed-Solomon/Merkle/SOC2/HIPAA/GDPR) | ❌ | 🆕 `/api/stats/security` posture | زخرفيّ بالكامل. يُستبدل بوضع أمنيّ **حقيقيّ** (KDF الفعليّ، سائق القاعدة، backend، SSRF، أعلام الكوكي). |
| قائمة «Active Client Nodes» | ✅ | `GET /api/sessions` | مربوطة. |
| زر Revoke جلسة | ✅ | `POST /api/sessions/:id/revoke` | مربوط. |
| «Emergency Zero-Out» | ❌ | 🆕 `POST /api/security/wipe-peers` | يفتح مودال وهميّ. |

---

## 6) AllFilesView.tsx
| العنصر | الحالة | endpoint | التفصيل / الإجراء |
|---|---|---|---|
| جدول الملفّات + فلترة الفئات + الفرز | ✅ | `GET /api/files` | مربوط. |
| تحديد افتراضيّ `['f-3']` و`find(f-3)` | ❌ | — | معرّفات وهمية من mock. تُزال. |
| Breadcrumb «Vaulta › … › Deliverables» | ❌ | — | ثابت. يصبح مسارًا حقيقيًّا (الجذر/المجلّد). |
| زر «Audit Logs» | ❌ | 🆕 `/api/activity?fileId` | `onClick={() => undefined}`. |
| التنزيل/المشاركة/الحذف/البثّ/الصورة المصغّرة | ✅ | `/api/files/:id/*`, `/api/shares` | مربوطة. |
| Technical Specs (قيم افتراضية «3840×2160 / DCI-P3 / 24fps…») | ⚠️ | `GET /api/files/:id` | تعرض قيمًا ثابتة حين تنقص. تُستبدل بقيم حقيقية (أبعاد/مدّة فعلية) أو تُخفى. |
| صندوق «Password Protected Link / 7 days / 12 views» | ❌ | 🆕 `GET /api/files/:id/shares` | ثابت. يصبح مشاركات الملف الحقيقية. |
| Version History («v3.2 Current» + تاريخ) | ❌ | `GET /api/files/:id` | لا نظام إصدارات. يُستبدل بنسخة واحدة حقيقية (وقت الإدخال). |
| Activity Audit Log (ثابت «fra-01…») | ❌ | 🆕 `GET /api/activity?fileId` | يصبح سجلّ نشاط الملف الحقيقيّ. |
| `VIDEO_PREVIEW_IMG` كـ poster | ❌ | `/api/files/:id/thumbnail` | صورة خارجية. تُستبدل بالصورة المصغّرة الحقيقية أو بديل CSS. |

---

## 7) RecentStarredView.tsx
| العنصر | الحالة | endpoint | التفصيل / الإجراء |
|---|---|---|---|
| قائمة الملفّات + فلتر Starred | ✅ | `GET /api/files` | مربوط. |
| فلتر «Last 24 Hours» (`modified.includes('m ago')`) | ⚠️ | — | **خطأ:** `formatRelative` يُخرج عربيًّا («قبل X د») فلا يطابق «m ago» أبدًا. يُصلَح باستخدام طابع زمنيّ حقيقيّ (`modifiedTs`). |

---

## 8) TrashView.tsx
| العنصر | الحالة | endpoint | التفصيل / الإجراء |
|---|---|---|---|
| قائمة السلّة + استعادة/حذف نهائيّ/إفراغ | ✅ | `/api/files/*` | مربوط. |
| `deletedDaysLeft` (ثابت 30) | ⚠️ | `GET /api/files` | يُشتقّ من `trashed_at` + حصة الاحتفاظ الحقيقية. |
| «FIPS 140-3 / zero-fill passes» | ⚠️ | — | نصّ زخرفيّ. يُخفَّف أو يُترك كوصف سياسة الاحتفاظ الحقيقية (أيّام الاحتفاظ من الإعدادات). |

---

## 9) SettingsView.tsx
| العنصر | الحالة | endpoint | التفصيل / الإجراء |
|---|---|---|---|
| حفظ/قراءة الإعدادات | ⚠️ | `GET/PUT /api/settings` | يحفظ فعلًا في KV، لكن الحقول خياليّة (Kyber-1024، Frankfurt، watermark، auto-expand) **بلا أثر وظيفيّ**. |
| **الإجراء** | 🆕 | `/api/settings`, `/api/account/password`, `/api/system` | تُستبدل بإعدادات حقيقية فعّالة: تخطيط العرض، الصور المصغّرة، أيّام احتفاظ السلّة (تُطبَّق فعلًا)، حصة التخزين، **تغيير كلمة المرور** (الـ endpoint موجود)، وعرض معلومات النظام الحقيقية. |

---

## 10) Sidebar.tsx
| العنصر | الحالة | endpoint | التفصيل / الإجراء |
|---|---|---|---|
| مقياس التخزين | ✅ | `/api/files` usage | مربوط. |
| `USER_AVATAR` + «Alex Rivera / Security Lead» | ❌ | `GET /api/auth/session` | صورة خارجية واسم ثابت. يُستبدل باسم المستخدم ودوره الحقيقيّين + صورة أحرف أوّلية. |
| Tenant Switcher (Acme/Starlight/…) | ❌ | — | حالة محليّة بلا باك إند (التطبيق مالك واحد). يُزال/يُستبدل باسم مساحة العمل الحقيقيّ. |
| زرّ Upgrade | ⚠️ | 🆕 حصة الإعدادات | يفتح مودال وهميّ (أسعار). يصبح ضبط حصة حقيقيّة. |

---

## 11) Header.tsx
| العنصر | الحالة | endpoint | التفصيل / الإجراء |
|---|---|---|---|
| Omnisearch → Command Palette | ✅ | عميل على `files` | مربوط. |
| `USER_AVATAR` | ❌ | session | يُستبدل بأحرف أوّلية. |
| الإشعارات (3 ثابتة) | ❌ | 🆕 `GET /api/activity` | قائمة ثابتة. تصبح أحدث نشاط حقيقيّ. |
| أزرار الفلترة (Type/People/Modified) | ❌ | — | `onFilterClick` → `addToast`. تُربط بفلترة فعلية أو تُزال. |

---

## 12) CommandPalette.tsx
| العنصر | الحالة | التفصيل |
|---|---|---|
| البحث عن الملفّات + التنقّل + الإجراءات | ✅ | يعمل على `files` الحقيقية. |

---

## 13) المودالات (modals/)
| المودال | الحالة | endpoint | التفصيل / الإجراء |
|---|---|---|---|
| `UploadModal` | ✅ | `/api/uploads/*`, `/api/downloads/*` | رفع مجزّأ + تحميل من رابط حقيقيّان. |
| `CreateShareDrawer` | ⚠️ | `POST /api/shares` | يُنشئ مشاركة حقيقية (password/expiry/burn=maxDownloads). لكن: vanity URL وwatermark وsteganography وipFilter **لا تُرسَل** (شكليّة). **الإجراء:** تنفيذ `ipFilter` كقائمة سماح IP حقيقية على المشاركة العامّة، وإزالة الخياليّ غير القابل للتنفيذ (watermark/stego)، وعرض رابط المشاركة الحقيقيّ بدل vanity الوهميّ. |
| `DeduplicationModal` | ❌ | 🆕 `GET /api/stats/dedup` + `POST .../purge` | `duplicates` ثابتة + `setTimeout`. يصبح كشف تكرار + حذف حقيقيّين. |
| `EmergencyZeroOutModal` | ❌ | 🆕 `POST /api/security/wipe-peers` | `setTimeout` + حالة محليّة. يصبح إلغاء كل الجلسات والمشاركات حقيقيًّا. |
| `UpgradeModal` | ❌ | 🆕 `PUT /api/settings {quotaBytes}` | خطط/أسعار ثابتة بلا فوترة. يصبح ضبط حصة تخزين حقيقية (تطبيق ذاتيّ، بلا فوترة خارجية — موثّق). |

---

## 14) مربوط ويعمل أصلًا (لا تغيير وظيفيّ)
`Login.tsx`, `PublicShare.tsx`, `VideoPlayer.tsx`, المصادقة، الملفّات، الرفع، التحميل، البثّ، السلّة،
البحث، الجلسات، SSE — كلّها حقيقية. تبقى كما هي عدا إضافة حالات التحميل/الخطأ حيث يلزم.

---

## 15) خطّة الـ endpoints الجديدة (التفصيل في `API_CONTRACT.md`)
- `GET  /api/stats/overview` — مقاييس النظرة العامّة.
- `GET  /api/stats/security` — تحليلات الأمان/السعة/النموّ/التكرار/الوضع الأمنيّ.
- `GET  /api/stats/dedup` — مجموعات التكرار + المساحة القابلة للاسترجاع.
- `POST /api/stats/dedup/purge` — حذف النسخ المكرّرة المختارة.
- `GET  /api/vaults` — المجلّدات كمساحات تعاون + ميتا.
- `GET  /api/activity` — سجلّ النشاط (+ فلترة `fileId`, `limit`).
- `GET  /api/files/:id/shares` — مشاركات ملف معيّن.
- `POST /api/security/wipe-peers` — مسح طارئ (إلغاء كل الجلسات الأخرى + كل المشاركات).
- توسعة `PUT /api/settings` لحصة التخزين وأيّام الاحتفاظ، وربط `POST /api/account/password` من الواجهة.
- توسعة المشاركات بقائمة سماح IP (`ip_allow`) وتسجيل النشاط.
- جدول جديد `activity_log` + مُنفِّذ احتفاظ السلّة الفعليّ في المجدوِل.
