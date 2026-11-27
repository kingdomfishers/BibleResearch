// @file: src/ui/context-tools/hebrew-calendar.ts
// @feature: context-tools
// @tables: none
// @candidates: none
// @toc: types | logic:primitives | logic:molad | logic:conversions | logic:feasts

// === @section:types ===
export type HebrewTradition = 'israel' | 'diaspora';
export type OmerCountingRule = 'rabbinic_nisan_16' | 'boethusian_sunday';

export type HebrewYearLength = 353 | 354 | 355 | 383 | 384 | 385;
export type HebrewYearTypeLabel =
  | 'Deficient (Chaserah)'
  | 'Regular (Kesidrah)'
  | 'Complete (Shelemah)';

export interface HebrewDateParts {
  year: number;
  month: number;
  day: number;
}

export interface GregorianDateParts {
  year: number;
  month: number;
  day: number;
}

export interface ComputedFeastDate {
  feastId: string;
  hebrewYear: number;
  hebrewDateText: string;
  eveBegins: Date;
  dayBegins: Date;
  endsEvening: Date;
  formattedRange: string;
  yearSummaryNote: string;
}

export interface HebrewYearSummary {
  hebrewYear: number;
  gregorianYear: number;
  isLeap: boolean;
  yearLengthDays: number;
  yearTypeLabel: HebrewYearTypeLabel;
  metonicCycleYear: number;
  roshHashanahDate: string;
}

/**
 * Standard biblical/ecclesiastical month numbering:
 * 1 = Nisan .. 6 = Elul, 7 = Tishrei .. 12 = Adar (or Adar I in leap years), 13 = Adar II.
 */
export const HEBREW_MONTH_NAMES: Readonly<Record<number, string>> = {
  1: 'Nisan',
  2: 'Iyar',
  3: 'Sivan',
  4: 'Tammuz',
  5: 'Av',
  6: 'Elul',
  7: 'Tishrei',
  8: 'Cheshvan',
  9: 'Kislev',
  10: 'Tevet',
  11: 'Shevat',
  12: 'Adar',
  13: 'Adar II',
};

export function getHebrewMonthName(hm: number, isLeap = false): string {
  if (hm === 12 && isLeap) return 'Adar I';
  return HEBREW_MONTH_NAMES[hm] ?? `Month ${hm}`;
}

// === @section:logic:primitives ===
/**
 * Rata Die (RD) epoch for 1 Tishrei, Year 1 AM (Monday, Oct 7, 3761 BCE proleptic Julian / -3760-09-07 Gregorian).
 * Relative to RD 1 = Monday, Jan 1, 1 CE (proleptic Gregorian).
 */
const HEBREW_EPOCH = -1373427;

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

function isGregorianLeapYear(gy: number): boolean {
  return mod(gy, 4) === 0 && (mod(gy, 100) !== 0 || mod(gy, 400) === 0);
}

export function isHebrewLeapYear(hy: number): boolean {
  return mod(7 * hy + 1, 19) < 7;
}

export function hebrewMonthsInYear(hy: number): number {
  return isHebrewLeapYear(hy) ? 13 : 12;
}

export function gregorianToAbsolute(gy: number, gm: number, gd: number): number {
  const y = gy - 1;
  let rd =
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) +
    Math.floor((367 * gm - 362) / 12) +
    gd;
  if (gm > 2) {
    rd += isGregorianLeapYear(gy) ? -1 : -2;
  }
  return rd;
}

export function absoluteToGregorian(abs: number): GregorianDateParts {
  const d0 = abs - 1;
  const n400 = Math.floor(d0 / 146097);
  const d1 = mod(d0, 146097);
  const n100 = Math.floor(d1 / 36524);
  const d2 = mod(d1, 36524);
  const n4 = Math.floor(d2 / 1461);
  const d3 = mod(d2, 1461);
  const n1 = Math.floor(d3 / 365);

  let year = 400 * n400 + 100 * n100 + 4 * n4 + n1;
  if (n100 !== 4 && n1 !== 4) {
    year += 1;
  }

  const priorDays = abs - gregorianToAbsolute(year, 1, 1);
  const correction =
    abs < gregorianToAbsolute(year, 3, 1) ? 0 : isGregorianLeapYear(year) ? 1 : 2;
  const month = Math.floor((12 * (priorDays + correction) + 373) / 367);
  const day = abs - gregorianToAbsolute(year, month, 1) + 1;

  return { year, month, day };
}

// === @section:logic:molad ===
/**
 * Computes elapsed days from 1 Tishrei 1 AM to 1 Tishrei `hy` via Molad Tishrei and the four
 * rabbinic postponement rules (Dechiyot):
 *  1. Molad Zaken: molad at or after 18h (noon) -> postpone 1 day.
 *  2. GaTRaD: common year with molad on Tuesday >= 9h 204p -> postpone 2 days (Wed -> Thu).
 *  3. BeTuTaKPoT: year following a leap year with molad on Monday >= 15h 589p -> postpone 1 day.
 *  4. Lo ADU: Rosh Hashanah cannot fall on Sunday (0), Wednesday (3), or Friday (5) -> postpone 1 day.
 */
function hebrewTishrei1ElapsedDays(hy: number): number {
  const monthsElapsed = Math.floor((235 * hy - 234) / 19);
  // Molad Tohu = Day 2 (Monday), 5h, 204 chalakim (5 * 1080 + 204 = 5604 parts).
  // Synodic lunar month = 29d 12h 793p (12 * 1080 + 793 = 13753 parts per excess over 29d).
  const parts = 5 * 1080 + 204 + 13753 * monthsElapsed;
  let day = 29 * monthsElapsed + Math.floor(parts / 25920);
  const remParts = mod(parts, 25920);
  const moladWeekday = mod(day + 1, 7); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat

  if (remParts >= 18 * 1080) {
    // Dechiyah 1: Molad Zaken (>= 18h = noon)
    day += 1;
  } else if (!isHebrewLeapYear(hy) && moladWeekday === 2 && remParts >= 9 * 1080 + 204) {
    // Dechiyah 3: GaTRaD (common year, Tuesday >= 9h 204p -> Tue->Wed->Thu)
    day += 2;
  } else if (isHebrewLeapYear(hy - 1) && moladWeekday === 1 && remParts >= 15 * 1080 + 589) {
    // Dechiyah 4: BeTuTaKPoT (post-leap year, Monday >= 15h 589p -> Tue)
    day += 1;
  }

  // Dechiyah 2: Lo ADU (Sunday=0, Wednesday=3, Friday=5)
  const weekday = mod(day + 1, 7);
  if (weekday === 0 || weekday === 3 || weekday === 5) {
    day += 1;
  }

  return day;
}

function tishrei1Absolute(hy: number): number {
  return HEBREW_EPOCH + hebrewTishrei1ElapsedDays(hy);
}

// === @section:logic:conversions ===
export function hebrewDaysInYear(hy: number): HebrewYearLength {
  const days = tishrei1Absolute(hy + 1) - tishrei1Absolute(hy);
  switch (days) {
    case 353:
    case 354:
    case 355:
    case 383:
    case 384:
    case 385:
      return days;
    default:
      throw new RangeError(`Unexpected Hebrew year length ${days} for year ${hy}`);
  }
}

export function lastDayOfHebrewMonth(hy: number, hm: number): number {
  if (hm === 2 || hm === 4 || hm === 6 || hm === 10 || hm === 13) {
    return 29;
  }
  if (hm === 12) {
    return isHebrewLeapYear(hy) ? 30 : 29;
  }
  if (hm === 8) {
    // Cheshvan has 30 days only in Complete (Shelemah) years (355 or 385 days).
    return mod(hebrewDaysInYear(hy), 10) === 5 ? 30 : 29;
  }
  if (hm === 9) {
    // Kislev has 29 days only in Deficient (Chaserah) years (353 or 383 days).
    return mod(hebrewDaysInYear(hy), 10) === 3 ? 29 : 30;
  }
  return 30;
}

export function hebrewToAbsolute(hy: number, hm: number, hd: number): number {
  let abs = tishrei1Absolute(hy) + hd - 1;
  if (hm < 7) {
    const months = hebrewMonthsInYear(hy);
    for (let m = 7; m <= months; m += 1) {
      abs += lastDayOfHebrewMonth(hy, m);
    }
    for (let m = 1; m < hm; m += 1) {
      abs += lastDayOfHebrewMonth(hy, m);
    }
  } else {
    for (let m = 7; m < hm; m += 1) {
      abs += lastDayOfHebrewMonth(hy, m);
    }
  }
  return abs;
}

export function absoluteToHebrew(abs: number): HebrewDateParts {
  // Mean Hebrew year is ~365.2468222 days; refine from approximation.
  let hy = Math.floor((abs - HEBREW_EPOCH) / 365.2468222) + 1;
  while (tishrei1Absolute(hy + 1) <= abs) {
    hy += 1;
  }
  while (tishrei1Absolute(hy) > abs) {
    hy -= 1;
  }

  let hm = abs < hebrewToAbsolute(hy, 1, 1) ? 7 : 1;
  while (abs > hebrewToAbsolute(hy, hm, lastDayOfHebrewMonth(hy, hm))) {
    hm += 1;
  }

  const hd = abs - hebrewToAbsolute(hy, hm, 1) + 1;
  return { year: hy, month: hm, day: hd };
}

export function gregorianToHebrew(gy: number, gm: number, gd: number): HebrewDateParts {
  return absoluteToHebrew(gregorianToAbsolute(gy, gm, gd));
}

// === @section:logic:feasts ===
function absoluteToLocalNoonDate(abs: number): Date {
  const { year, month, day } = absoluteToGregorian(abs);
  // Use local noon to stay immune to DST midnight shifts and most UTC-date shifts.
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  date.setFullYear(year);
  return date;
}

function formatShortDate(abs: number, includeYear = false): string {
  const { year, month, day } = absoluteToGregorian(abs);
  const base = `${SHORT_MONTHS[month - 1]} ${day}`;
  return includeYear ? `${base}, ${year}` : base;
}

function formatEveRange(eveAbs: number, dayAbs: number, endAbs: number): string {
  const eve = absoluteToGregorian(eveAbs);
  const day = absoluteToGregorian(dayAbs);
  const end = absoluteToGregorian(endAbs);

  if (dayAbs === endAbs) {
    if (eve.year === end.year && eve.month === end.month) {
      return `Eve ${SHORT_MONTHS[eve.month - 1]} ${eve.day} – ${end.day}, ${end.year}`;
    }
    if (eve.year === end.year) {
      return `Eve ${formatShortDate(eveAbs)} – ${formatShortDate(endAbs, true)}`;
    }
    return `Eve ${formatShortDate(eveAbs, true)} – ${formatShortDate(endAbs, true)}`;
  }

  if (eve.year === end.year && eve.month === end.month) {
    return `Eve ${SHORT_MONTHS[eve.month - 1]} ${eve.day} (${SHORT_MONTHS[day.month - 1]} ${day.day}–${end.day}), ${end.year}`;
  }
  if (eve.year === end.year) {
    return `Eve ${formatShortDate(eveAbs)} (${formatShortDate(dayAbs)}–${formatShortDate(endAbs)}), ${end.year}`;
  }
  return `Eve ${formatShortDate(eveAbs, true)} – ${formatShortDate(endAbs, true)}`;
}

function yearTypeLabelForLength(days: HebrewYearLength): HebrewYearTypeLabel {
  const rem = mod(days, 10);
  if (rem === 3) return 'Deficient (Chaserah)';
  if (rem === 5) return 'Complete (Shelemah)';
  return 'Regular (Kesidrah)';
}

function buildFeastEntry(
  feastId: string,
  hebrewYear: number,
  hebrewDateText: string,
  eveAbs: number,
  dayAbs: number,
  endAbs: number,
  yearSummaryNote: string,
): ComputedFeastDate {
  return {
    feastId,
    hebrewYear,
    hebrewDateText,
    eveBegins: absoluteToLocalNoonDate(eveAbs),
    dayBegins: absoluteToLocalNoonDate(dayAbs),
    endsEvening: absoluteToLocalNoonDate(endAbs),
    formattedRange: formatEveRange(eveAbs, dayAbs, endAbs),
    yearSummaryNote,
  };
}

export function explainHebrewYearCalculation(gregorianYear: number): HebrewYearSummary {
  const hebrewYear = gregorianYear + 3761;
  const isLeap = isHebrewLeapYear(hebrewYear);
  const yearLengthDays = hebrewDaysInYear(hebrewYear);
  const metonicCycleYear = mod(hebrewYear - 1, 19) + 1;
  const rhAbs = tishrei1Absolute(hebrewYear);

  return {
    hebrewYear,
    gregorianYear,
    isLeap,
    yearLengthDays,
    yearTypeLabel: yearTypeLabelForLength(yearLengthDays),
    metonicCycleYear,
    roshHashanahDate: formatShortDate(rhAbs, true),
  };
}

export function computeFeastDatesForGregorianYear(
  gregorianYear: number,
  opts?: { tradition?: HebrewTradition; omerRule?: OmerCountingRule },
): Record<string, ComputedFeastDate> {
  const tradition: HebrewTradition = opts?.tradition ?? 'israel';
  const omerRule: OmerCountingRule = opts?.omerRule ?? 'rabbinic_nisan_16';

  const hySpring = gregorianYear + 3760;
  const hyFall = gregorianYear + 3761;
  const springLeap = isHebrewLeapYear(hySpring);
  const springDays = hebrewDaysInYear(hySpring);
  const fallDays = hebrewDaysInYear(hyFall);
  const springNote = `AM ${hySpring} (${springDays} days${springLeap ? ', leap year with Adar I/II' : ''})`;
  const fallNote = `AM ${hyFall} (${fallDays} days, ${yearTypeLabelForLength(fallDays)})`;

  // 1. Purim (Adar 14, or Adar II 14 in leap year)
  const purimMonth = springLeap ? 13 : 12;
  const purimDayAbs = hebrewToAbsolute(hySpring, purimMonth, 14);
  const purimMonthLabel = springLeap ? 'Adar II' : 'Adar';

  // 2. Pesach (Nisan 14 afternoon slaughter / Seder eve of Nisan 15)
  const nisan14Abs = hebrewToAbsolute(hySpring, 1, 14);
  const nisan15Abs = nisan14Abs + 1;
  const pesachEndAbs = tradition === 'diaspora' ? nisan15Abs + 1 : nisan15Abs;

  // 3. Feast of Unleavened Bread (Nisan 15-21 Israel, Nisan 15-22 Diaspora)
  const unleavenedEndAbs = hebrewToAbsolute(hySpring, 1, tradition === 'diaspora' ? 22 : 21);

  // 4. Firstfruits / Wave Sheaf (Nisan 16 or Sunday strictly after weekly Sabbath in Nisan 15-21)
  let firstfruitsAbs = hebrewToAbsolute(hySpring, 1, 16);
  let firstfruitsHebrewText = 'Nisan 16';
  let firstfruitsRuleNote = 'Rabbinic Nisan 16 anchor (interpreting "Shabbat" in Lev 23:11 as Yom Tov Nisan 15)';

  if (omerRule === 'boethusian_sunday') {
    const nisan21Abs = hebrewToAbsolute(hySpring, 1, 21);
    for (let abs = nisan15Abs; abs <= nisan21Abs; abs += 1) {
      if (mod(abs, 7) === 6) {
        firstfruitsAbs = abs + 1;
        break;
      }
    }
    const ffHeb = absoluteToHebrew(firstfruitsAbs);
    firstfruitsHebrewText = `Nisan ${ffHeb.day} (Sunday)`;
    firstfruitsRuleNote =
      'Boethusian/Sadducean reading: first Sunday strictly after the weekly Sabbath inside Nisan 15–21';
  }

  // 5. Shavuot (+49 days after Firstfruits anchor; 50th day inclusive)
  const shavuotAbs = firstfruitsAbs + 49;
  const shavuotHeb = absoluteToHebrew(shavuotAbs);
  const shavuotTwoDays = tradition === 'diaspora' && omerRule === 'rabbinic_nisan_16';
  const shavuotEndAbs = shavuotTwoDays ? shavuotAbs + 1 : shavuotAbs;
  const shavuotHebText = shavuotTwoDays
    ? `${getHebrewMonthName(shavuotHeb.month, springLeap)} ${shavuotHeb.day}–${shavuotHeb.day + 1}`
    : `${getHebrewMonthName(shavuotHeb.month, springLeap)} ${shavuotHeb.day}`;

  // 6. Yom Teruah / Rosh Hashanah (Tishrei 1; +2 days Diaspora)
  const tishrei1Abs = hebrewToAbsolute(hyFall, 7, 1);
  const teruahEndAbs = tradition === 'diaspora' ? tishrei1Abs + 1 : tishrei1Abs;

  // 7. Yom Kippur (Tishrei 10)
  const yomKippurAbs = tishrei1Abs + 9;

  // 8. Sukkot (Tishrei 15-21)
  const sukkotStartAbs = tishrei1Abs + 14;
  const sukkotEndAbs = tishrei1Abs + 20;

  // 9. Shemini Atzeret (Tishrei 22; +1 day Diaspora Simchat Torah)
  const sheminiAbs = tishrei1Abs + 21;
  const sheminiEndAbs = tradition === 'diaspora' ? sheminiAbs + 1 : sheminiAbs;

  // 10. Hanukkah (Kislev 25 - Tevet 2 or 3, 8 days)
  const hanukkahStartAbs = hebrewToAbsolute(hyFall, 9, 25);
  const hanukkahEndAbs = hanukkahStartAbs + 7;
  const hanukkahEndHeb = absoluteToHebrew(hanukkahEndAbs);
  const kislevDays = lastDayOfHebrewMonth(hyFall, 9);

  return {
    purim: buildFeastEntry(
      'purim',
      hySpring,
      `${purimMonthLabel} 14`,
      purimDayAbs - 1,
      purimDayAbs,
      purimDayAbs,
      `${springNote}; walled cities observe Shushan Purim on ${purimMonthLabel} 15`,
    ),
    pesach: buildFeastEntry(
      'pesach',
      hySpring,
      tradition === 'diaspora' ? 'Nisan 14 (eve) – 16' : 'Nisan 14 (eve) – 15',
      nisan14Abs,
      nisan15Abs,
      pesachEndAbs,
      `${springNote}; Pesach sacrifice slain afternoon of Nisan 14, Seder begins after sunset`,
    ),
    unleavened: buildFeastEntry(
      'unleavened',
      hySpring,
      tradition === 'diaspora' ? 'Nisan 15–22' : 'Nisan 15–21',
      nisan14Abs,
      nisan15Abs,
      unleavenedEndAbs,
      `${springNote}; ${tradition === 'diaspora' ? '8-day Diaspora observance' : '7-day Torah observance'}`,
    ),
    firstfruits: buildFeastEntry(
      'firstfruits',
      hySpring,
      firstfruitsHebrewText,
      firstfruitsAbs - 1,
      firstfruitsAbs,
      firstfruitsAbs,
      `${springNote}; ${firstfruitsRuleNote}`,
    ),
    shavuot: buildFeastEntry(
      'shavuot',
      hySpring,
      shavuotHebText,
      shavuotAbs - 1,
      shavuotAbs,
      shavuotEndAbs,
      `${springNote}; 50th day (49 days after Firstfruits anchor)`,
    ),
    teruah: buildFeastEntry(
      'teruah',
      hyFall,
      tradition === 'diaspora' ? 'Tishrei 1–2' : 'Tishrei 1',
      tishrei1Abs - 1,
      tishrei1Abs,
      teruahEndAbs,
      `${fallNote}; Torah sets Tishrei 1 (later rabbinic practice keeps 2 days in both Israel & Diaspora)`,
    ),
    yom_kippur: buildFeastEntry(
      'yom_kippur',
      hyFall,
      'Tishrei 10',
      yomKippurAbs - 1,
      yomKippurAbs,
      yomKippurAbs,
      `${fallNote}; fast begins before sunset on Tishrei 9`,
    ),
    sukkot: buildFeastEntry(
      'sukkot',
      hyFall,
      'Tishrei 15–21',
      sukkotStartAbs - 1,
      sukkotStartAbs,
      sukkotEndAbs,
      `${fallNote}; 7-day pilgrimage festival culminating in Hoshana Rabbah (Tishrei 21)`,
    ),
    shemini_atzeret: buildFeastEntry(
      'shemini_atzeret',
      hyFall,
      tradition === 'diaspora' ? 'Tishrei 22–23' : 'Tishrei 22',
      sheminiAbs - 1,
      sheminiAbs,
      sheminiEndAbs,
      `${fallNote}; ${
        tradition === 'diaspora'
          ? 'Diaspora celebrates Shemini Atzeret (Tishrei 22) and Simchat Torah (Tishrei 23) separately'
          : 'Israel combines Shemini Atzeret and Simchat Torah on Tishrei 22'
      }`,
    ),
    hanukkah: buildFeastEntry(
      'hanukkah',
      hyFall,
      `Kislev 25 – Tevet ${hanukkahEndHeb.day}`,
      hanukkahStartAbs - 1,
      hanukkahStartAbs,
      hanukkahEndAbs,
      `${fallNote}; Kislev has ${kislevDays} days so day 8 lands on Tevet ${hanukkahEndHeb.day}`,
    ),
  };
}
