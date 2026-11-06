// Does a post or headline concern Hormuz shipping or Gulf civil infrastructure? Used by the free feeds.
// STRONG terms match alone. TOPIC terms (ship, port, refinery...) need a REGION term too, unless the
// source itself is about Iran/the Gulf (region: true). Terms from research/source-catalog.md §A;
// the infrastructure and Persian topic words are from model memory.
// Latin terms: whole words (plural s/es allowed). Arabic-script and Hebrew terms: must start a word, any
// suffix allowed (Persian/Arabic attach them), so قایق "boat" doesn't fire inside دقایق "minutes".
// Chinese has no word breaks, so plain substring.
const CJK = /[\u3400-\u9fff]/;
const re = (w) => /^[a-z ]+$/.test(w) ? new RegExp(`\\b${w}(s|es)?\\b`, "i") : CJK.test(w) ? null : new RegExp(`(?<![\\p{L}\\p{M}\\u200c])${w}`, "u");
const compile = (list) => list.map((w) => [w, re(w)]);
const has = (h, list) => list.some(([w, r]) => (r ? r.test(h) : h.includes(w)));
const STRONG = compile([
  "hormuz", "fujairah", "bandar abbas", "qeshm", "kharg", "jask", "khasab", "musandam", "ras tanura", "ras laffan", "gulf of oman", "larak",
  "هرمز", "الفجيرة", "مسندم", "خصب", "بندر عباس", "رأس تنورة", "رأس لفان", "خليج عمان",
  "بندرعباس", "قشم", "خارگ", "خارک", "جاسک", "لارک", "دریای عمان", "فجیره",
  "הורמוז", "霍尔木兹", "霍爾木茲",
]);
const REGION = compile(["iran", "irgc", "persian gulf", "arabian gulf", "uae", "oman", "qatar", "bahrain", "kuwait", "saudi",
  "إيران", "الخليج", "الحرس الثوري", "الإمارات", "عمان", "قطر", "ایران", "سپاه", "خلیج فارس", "איראן", "伊朗", "波斯湾"]);
const TOPIC = compile(["tanker", "vessel", "ship", "freighter", "lng carrier", "navy", "naval", "port", "harbour", "harbor", "oil terminal", "refinery",
  "desalination", "power plant", "undersea cable", "speedboat", "mine",
  "ناقلة", "ناقلات", "سفينة", "سفن", "ميناء", "مصفاة", "تحلية", "بحرية", "زورق",
  "نفتکش", "کشتی", "شناور", "ناو", "بندر", "پالایشگاه", "آب‌شیرین‌کن", "نیروی دریایی", "قایق", "اسکله",
  "מכלית", "ספינה", "אונייה", "油轮", "油輪", "船"]);
export function relevant(text, regionImplied = false) {
  const h = String(text ?? "").toLowerCase();
  if (has(h, STRONG)) return true;
  return has(h, TOPIC) && (regionImplied || has(h, REGION));
}
