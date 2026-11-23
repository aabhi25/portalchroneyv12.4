/**
 * Amounts written out in words before they are spoken, Indian style (lakh, crore): both OpenAI
 * voices read "₹1,20,000" as "one thousand twenty thousand" now and then, and drop "rupees"
 * (heard 2026-11-24). Only amounts with ₹ / Rs. and numbers grouped with commas are touched, so
 * years, phone numbers and formulas stay as they are.
 */
const EN_ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const HI = ("शून्य एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस " +
  "बीस इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस " +
  "चालीस इकतालीस बयालीस तैंतालीस चौवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास पचास इक्यावन बावन तिरपन चौवन पचपन छप्पन सत्तावन अट्ठावन उनसठ " +
  "साठ इकसठ बासठ तिरसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर सत्तर इकहत्तर बहत्तर तिहत्तर चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उनासी " +
  "अस्सी इक्यासी बयासी तिरासी चौरासी पचासी छियासी सत्तासी अट्ठासी नवासी नब्बे इक्यानवे बानवे तिरानवे चौरानवे पचानवे छियानवे सत्तानवे अट्ठानवे निन्यानवे").split(" ");

const below100 = (n: number, hindi: boolean): string =>
  hindi ? HI[n] : n < 20 ? EN_ONES[n] : EN_TENS[Math.floor(n / 10)] + (n % 10 ? ` ${EN_ONES[n % 10]}` : "");

/** A whole number in words (up to 99,99,99,999), Indian grouping. */
export function amountInWords(n: number, hindi: boolean): string {
  if (n < 100) return below100(n, hindi);
  const parts: string[] = [];
  let rest = n;
  for (const [size, en, hi] of [[1e7, "crore", "करोड़"], [1e5, "lakh", "लाख"], [1e3, "thousand", "हज़ार"], [100, "hundred", "सौ"]] as const) {
    const count = Math.floor(rest / size);
    if (count) parts.push(`${count < 100 ? below100(count, hindi) : amountInWords(count, hindi)} ${hindi ? hi : en}`);
    rest %= size;
  }
  if (rest) parts.push(below100(rest, hindi));
  return parts.join(" ");
}

const NUMBER = String.raw`\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
const AMOUNT = new RegExp(String.raw`(?:₹|\bRs\.?|\bINR)\s?(${NUMBER})(\s?(?:lakhs?|crores?|thousand|लाख|करोड़|हज़ार|हजार)(?![\p{L}\p{M}]))?`, "giu");
const GROUPED = /(?<![\d.,])\d{1,3}(?:,\d{2,3})+(?:\.\d+)?(?![\d,])/g;

function words(digits: string, hindi: boolean): string {
  const [whole, decimals] = digits.replace(/,/g, "").split(".");
  const n = Number(whole);
  if (!Number.isSafeInteger(n) || n > 999_999_999) return digits;
  const tail = decimals && Number(decimals) ? ` ${hindi ? "दशमलव" : "point"} ${decimals.replace(/0+$/, "").split("").map((d) => below100(Number(d), hindi)).join(" ")}` : "";
  return amountInWords(n, hindi) + tail;
}

export function spokenAmounts(text: string): string {
  const hindi = /[ऀ-ॿ]/.test(text);
  return text
    .replace(AMOUNT, (_m, n: string, unit?: string) => `${words(n, hindi)}${unit ? ` ${unit.trim()}` : ""} ${hindi ? "रुपये" : "rupees"}`)
    .replace(GROUPED, (n) => words(n, hindi));
}
