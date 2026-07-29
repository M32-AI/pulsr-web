// Maps common abbreviations to IANA timezone identifiers.
// Kept in sync with the backend's ABBREVIATION_TO_IANA (pulsr-backend
// lib/timezone.ts), which is the source of truth. PHT/PHST (Philippines) are
// the important ones here — most VAs are Manila, and without them the frontend
// fell back to UTC and reported 0 hours during their morning (PRODUCT-26048).
export const TIMEZONE_MAP: Record<string, string> = {
  EST: "America/New_York",
  EDT: "America/New_York",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  MST: "America/Denver",
  MDT: "America/Denver",
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  CDMX: "America/Mexico_City",
  UTC: "UTC",
  GMT: "Etc/GMT",
  BST: "Europe/London",
  CET: "Europe/Paris",
  CEST: "Europe/Paris",
  EET: "Europe/Helsinki",
  EEST: "Europe/Helsinki",
  IST: "Asia/Kolkata",
  JST: "Asia/Tokyo",
  SGT: "Asia/Singapore",
  PKT: "Asia/Karachi",
  BDT: "Asia/Dhaka",
  GST: "Asia/Dubai",
  PHT: "Asia/Manila",
  PHST: "Asia/Manila",
  AEST: "Australia/Sydney",
  AEDT: "Australia/Sydney",
};

/**
 * Today's date (YYYY-MM-DD) in the VA's shift timezone, so "today" means the
 * VA's local day rather than the viewer's UTC day. Accepts an abbreviation
 * ("PHT") or a raw IANA zone ("Asia/Manila"); unknown values fall back to the
 * UTC date (no worse than before). Fix for HOURS TODAY reading 0 for VAs ahead
 * of UTC (PRODUCT-26048).
 */
export function localDateInShiftTZ(
  shiftTimeZone: string | null | undefined,
  when: Date = new Date(),
): string {
  const raw = (shiftTimeZone ?? "").trim();
  const iana = TIMEZONE_MAP[raw.toUpperCase()] ?? raw;
  try {
    return when.toLocaleDateString("en-CA", { timeZone: iana || "UTC" });
  } catch {
    return when.toISOString().slice(0, 10);
  }
}

interface ShiftTiming {
  shift_end_time: string;
  shift_start_time: string;
  shift_time_zone: string;
}

export function convertShiftToLocalTime(shift: ShiftTiming): {
  localStartTime: string;
  localEndTime: string;
  localTimeZone: string;
} {
  const ianaTimezone =
    TIMEZONE_MAP[shift?.shift_time_zone?.toUpperCase() ?? ""];

  if (!ianaTimezone) {
    return { localStartTime: "", localEndTime: "", localTimeZone: "" };
  }

  const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const convertTime = (time: string): string => {
    const [hours, minutes] = time.split(":").map(Number);
    const today = new Date();
    const dateString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const shiftDateTimeString = `${dateString}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
    const utcDate = new Date(
      new Date(shiftDateTimeString).toLocaleString("en-US", {
        timeZone: ianaTimezone,
      }),
    );
    const diff = new Date(shiftDateTimeString).getTime() - utcDate.getTime();
    const adjustedDate = new Date(new Date(shiftDateTimeString).getTime() + diff);
    return adjustedDate.toLocaleTimeString("en-GB", {
      timeZone: localTimeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  return {
    localStartTime: convertTime(shift.shift_start_time),
    localEndTime: convertTime(shift.shift_end_time),
    localTimeZone,
  };
}

export function calculateShiftCountdown(
  startTime: string,
  endTime: string,
  shiftTimeZone: string,
): { starting_in: string; ending_in: string; startDiffMinutes: number } {
  const ianaTimezone = TIMEZONE_MAP[shiftTimeZone.toUpperCase()];
  if (!ianaTimezone) {
    return { starting_in: "", ending_in: "", startDiffMinutes: 0 };
  }

  const formatDuration = (diffMinutes: number): string => {
    if (diffMinutes <= 0) return "Started";
    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;
    const hoursPart = hours > 0 ? `${hours}H` : "";
    const minutesPart = minutes > 0 ? `${minutes}M` : "";
    return [hoursPart, minutesPart].filter(Boolean).join(" ");
  };

  const getShiftDateTimeInUTC = (time: string): number => {
    const [hours, minutes] = time.split(":").map(Number);
    const todayInShiftTZ = new Date().toLocaleDateString("en-CA", {
      timeZone: ianaTimezone,
    });
    const shiftDateTimeString = `${todayInShiftTZ}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
    const utcDate = new Date(
      new Date(shiftDateTimeString).toLocaleString("en-US", {
        timeZone: ianaTimezone,
      }),
    );
    const diff = new Date(shiftDateTimeString).getTime() - utcDate.getTime();
    return new Date(shiftDateTimeString).getTime() + diff;
  };

  const nowMs = Date.now();
  const startMs = getShiftDateTimeInUTC(startTime);
  const endMs = getShiftDateTimeInUTC(endTime);
  const startDiffMinutes = Math.floor((startMs - nowMs) / 1000 / 60);
  const endDiffMinutes = Math.floor((endMs - nowMs) / 1000 / 60);

  return {
    starting_in: formatDuration(startDiffMinutes),
    ending_in: formatDuration(endDiffMinutes),
    startDiffMinutes,
  };
}
