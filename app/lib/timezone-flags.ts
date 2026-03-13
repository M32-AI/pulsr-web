/**
 * Maps timezone abbreviations (e.g. "EST", "IST") to country flag emojis.
 */
export const TIMEZONE_FLAGS: Record<string, string> = {
  // USA / North America
  EST: "🇺🇸", // Eastern Standard Time
  EDT: "🇺🇸", // Eastern Daylight Time
  CST: "🇺🇸", // Central Standard Time
  CDT: "🇺🇸", // Central Daylight Time
  MST: "🇺🇸", // Mountain Standard Time
  MDT: "🇺🇸", // Mountain Daylight Time
  PST: "🇺🇸", // Pacific Standard Time
  PDT: "🇺🇸", // Pacific Daylight Time
  AKST: "🇺🇸", // Alaska Standard Time
  HST: "🇺🇸", // Hawaii Standard Time

  // India
  IST: "🇮🇳", // India Standard Time

  // Philippines
  PHT: "🇵🇭",  // Philippine Time
  PST8: "🇵🇭", // Philippine Standard Time (alternate)

  // Pakistan
  PKT: "🇵🇰", // Pakistan Standard Time

  // Bangladesh
  BST: "🇧🇩", // Bangladesh Standard Time

  // Sri Lanka
  SLST: "🇱🇰", // Sri Lanka Standard Time

  // Nepal
  NPT: "🇳🇵", // Nepal Time

  // Myanmar
  MMT: "🇲🇲", // Myanmar Time

  // Thailand / Vietnam / Indonesia (WIB)
  ICT: "🇹🇭", // Indochina Time

  // Malaysia / Singapore
  MYT: "🇲🇾", // Malaysia Time
  SGT: "🇸🇬", // Singapore Time

  // China / HK / Taiwan
  CST8: "🇨🇳", // China Standard Time (alternate key to avoid CST clash)
  HKT: "🇭🇰", // Hong Kong Time
  TST: "🇹🇼", // Taiwan Standard Time

  // Japan
  JST: "🇯🇵", // Japan Standard Time

  // South Korea
  KST: "🇰🇷", // Korea Standard Time

  // Indonesia
  WIB: "🇮🇩", // Western Indonesia Time
  WITA: "🇮🇩", // Central Indonesia Time
  WIT: "🇮🇩",  // Eastern Indonesia Time

  // UAE / Gulf
  GST: "🇦🇪", // Gulf Standard Time
  AST: "🇸🇦", // Arabia Standard Time

  // Israel
  IST2: "🇮🇱", // Israel Standard Time (alternate)

  // Turkey
  TRT: "🇹🇷", // Turkey Time

  // Egypt
  EET: "🇪🇬", // Eastern European Time

  // Nigeria / West Africa
  WAT: "🇳🇬", // West Africa Time

  // Kenya / East Africa
  EAT: "🇰🇪", // East Africa Time

  // South Africa
  SAST: "🇿🇦", // South Africa Standard Time

  // UK
  GMT: "🇬🇧", // Greenwich Mean Time
  BST2: "🇬🇧", // British Summer Time (alternate)

  // Europe (Central)
  CET: "🇩🇪",  // Central European Time
  CEST: "🇩🇪", // Central European Summer Time

  // Russia
  MSK: "🇷🇺", // Moscow Standard Time

  // Canada
  NST: "🇨🇦", // Newfoundland Standard Time
  NDT: "🇨🇦", // Newfoundland Daylight Time

  // Brazil
  BRT: "🇧🇷", // Brasília Time
  BRST: "🇧🇷", // Brasília Summer Time

  // Argentina
  ART: "🇦🇷", // Argentina Time

  // Colombia / Peru / Ecuador
  COT: "🇨🇴", // Colombia Time
  PET: "🇵🇪", // Peru Time

  // Chile
  CLT: "🇨🇱", // Chile Standard Time

  // Mexico
  CST6: "🇲🇽", // Central Standard Time Mexico (alternate)

  // Australia
  AEST: "🇦🇺", // Australian Eastern Standard Time
  AEDT: "🇦🇺", // Australian Eastern Daylight Time
  ACST: "🇦🇺", // Australian Central Standard Time
  AWST: "🇦🇺", // Australian Western Standard Time

  // New Zealand
  NZST: "🇳🇿", // New Zealand Standard Time
  NZDT: "🇳🇿", // New Zealand Daylight Time

  // UTC
  UTC: "🌐",
};

/**
 * Returns the country flag emoji for a given timezone abbreviation (e.g. "EST", "IST").
 * Case-insensitive. Returns "" if not found.
 */
export function timezoneToFlag(tz: string | null | undefined): string {
  if (!tz) return TIMEZONE_FLAGS["UTC"] ?? "";
  return TIMEZONE_FLAGS[tz.trim().toUpperCase()] ?? "";
}

/**
 * UTC offset in minutes for each timezone abbreviation.
 * Used to correctly compute shift start times regardless of the browser's local timezone.
 */
export const TZ_OFFSET_MINUTES: Record<string, number> = {
  // UTC
  UTC: 0,
  GMT: 0,

  // USA
  EST: -300,  // UTC-5
  EDT: -240,  // UTC-4
  CST: -360,  // UTC-6
  CDT: -300,  // UTC-5
  MST: -420,  // UTC-7
  MDT: -360,  // UTC-6
  PST: -480,  // UTC-8
  PDT: -420,  // UTC-7
  AKST: -540, // UTC-9
  HST: -600,  // UTC-10

  // Canada
  NST: -210,  // UTC-3:30
  NDT: -150,  // UTC-2:30

  // India
  IST: 330,   // UTC+5:30

  // Philippines
  PHT: 480,   // UTC+8

  // Pakistan
  PKT: 300,   // UTC+5

  // Bangladesh
  BST: 360,   // UTC+6

  // Sri Lanka
  SLST: 330,  // UTC+5:30

  // Nepal
  NPT: 345,   // UTC+5:45

  // Myanmar
  MMT: 390,   // UTC+6:30

  // Thailand / Vietnam / Indochina
  ICT: 420,   // UTC+7

  // Malaysia
  MYT: 480,   // UTC+8

  // Singapore
  SGT: 480,   // UTC+8

  // China / HK / Taiwan
  CST8: 480,  // UTC+8
  HKT: 480,   // UTC+8
  TST: 480,   // UTC+8

  // Japan
  JST: 540,   // UTC+9

  // South Korea
  KST: 540,   // UTC+9

  // Indonesia
  WIB: 420,   // UTC+7
  WITA: 480,  // UTC+8
  WIT: 540,   // UTC+9

  // UAE / Gulf
  GST: 240,   // UTC+4
  AST: 180,   // UTC+3

  // Turkey
  TRT: 180,   // UTC+3

  // Egypt / Eastern Europe
  EET: 120,   // UTC+2

  // West Africa
  WAT: 60,    // UTC+1

  // East Africa
  EAT: 180,   // UTC+3

  // South Africa
  SAST: 120,  // UTC+2

  // Central Europe
  CET: 60,    // UTC+1
  CEST: 120,  // UTC+2

  // Russia
  MSK: 180,   // UTC+3

  // Brazil
  BRT: -180,  // UTC-3
  BRST: -120, // UTC-2

  // Argentina
  ART: -180,  // UTC-3

  // Colombia / Peru
  COT: -300,  // UTC-5
  PET: -300,  // UTC-5

  // Chile
  CLT: -240,  // UTC-4

  // Australia
  AEST: 600,  // UTC+10
  AEDT: 660,  // UTC+11
  ACST: 570,  // UTC+9:30
  AWST: 480,  // UTC+8

  // New Zealand
  NZST: 720,  // UTC+12
  NZDT: 780,  // UTC+13
};

/**
 * Given a shift_start_time ("HH:MM") and timezone abbreviation ("IST", "EST"),
 * returns a Date representing today's shift start in UTC.
 */
export function shiftStartToUTC(timeHHMM: string, tzAbbr: string): Date {
  const [sh, sm] = timeHHMM.split(":").map(Number);
  const offsetMin = TZ_OFFSET_MINUTES[tzAbbr?.trim().toUpperCase()] ?? 0;

  // Get "today" in the VA's timezone by shifting UTC now by the offset
  const nowInVaTz = new Date(Date.now() + offsetMin * 60_000);

  // Build shift start as a UTC timestamp:
  // today's date (in VA tz) at sh:sm (VA tz) → subtract offset to get UTC
  const shiftUtcMs =
    Date.UTC(
      nowInVaTz.getUTCFullYear(),
      nowInVaTz.getUTCMonth(),
      nowInVaTz.getUTCDate(),
      sh,
      sm,
      0,
      0,
    ) - offsetMin * 60_000;

  return new Date(shiftUtcMs);
}
