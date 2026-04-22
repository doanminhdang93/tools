const COMBINING_MARKS_REGEX = /[̀-ͯ]/g;
const WHITESPACE_REGEX = /\s+/;

const SPECIAL_CHAR_MAP: Record<string, string> = {
  đ: "d",
  Đ: "D",
};

function stripVietnameseDiacritics(input: string): string {
  const substituted = [...input].map((character) => SPECIAL_CHAR_MAP[character] ?? character).join("");
  return substituted.normalize("NFD").replace(COMBINING_MARKS_REGEX, "");
}

function capitalizeFirst(word: string): string {
  if (word.length === 0) return "";
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

function firstLetterUppercase(word: string): string {
  const stripped = stripVietnameseDiacritics(word);
  return stripped[0]?.toUpperCase() ?? "";
}

export function deriveTabName(fullName: string): string {
  const nameParts = fullName.trim().split(WHITESPACE_REGEX).filter(Boolean);

  if (nameParts.length === 0) {
    throw new Error("deriveTabName: empty name");
  }

  const givenName = nameParts[nameParts.length - 1];
  const familyAndMiddle = nameParts.slice(0, -1);

  const givenPart = capitalizeFirst(stripVietnameseDiacritics(givenName));
  const initials = familyAndMiddle.map(firstLetterUppercase).join("");

  return givenPart + initials;
}
