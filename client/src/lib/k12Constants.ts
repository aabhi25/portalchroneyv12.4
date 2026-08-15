export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectOptionGroup {
  label: string;
  options: SelectOption[];
}

export const K12_BOARDS: SelectOptionGroup[] = [
  {
    label: "National Boards",
    options: [
      { value: "CBSE", label: "CBSE" },
      { value: "ICSE", label: "ICSE / CISCE" },
      { value: "NIOS", label: "NIOS" },
    ],
  },
  {
    label: "State Boards",
    options: [
      { value: "Andhra Pradesh Board", label: "Andhra Pradesh Board" },
      { value: "Assam Board", label: "Assam Board" },
      { value: "Bihar Board", label: "Bihar Board" },
      { value: "Chhattisgarh Board", label: "Chhattisgarh Board" },
      { value: "Goa Board", label: "Goa Board" },
      { value: "Gujarat Board", label: "Gujarat Board" },
      { value: "Haryana Board", label: "Haryana Board" },
      { value: "Himachal Pradesh Board", label: "Himachal Pradesh Board" },
      { value: "Jharkhand Board", label: "Jharkhand Board" },
      { value: "J&K Board", label: "Jammu & Kashmir Board" },
      { value: "Karnataka Board", label: "Karnataka Board" },
      { value: "Kerala Board", label: "Kerala Board" },
      { value: "Madhya Pradesh Board", label: "Madhya Pradesh Board" },
      { value: "Maharashtra Board", label: "Maharashtra Board" },
      { value: "Manipur Board", label: "Manipur Board" },
      { value: "Meghalaya Board", label: "Meghalaya Board" },
      { value: "Mizoram Board", label: "Mizoram Board" },
      { value: "Nagaland Board", label: "Nagaland Board" },
      { value: "Odisha Board", label: "Odisha Board" },
      { value: "Punjab Board", label: "Punjab Board" },
      { value: "Rajasthan Board", label: "Rajasthan Board" },
      { value: "Sikkim Board", label: "Sikkim Board" },
      { value: "Tamil Nadu Board", label: "Tamil Nadu Board" },
      { value: "Telangana Board", label: "Telangana Board" },
      { value: "Tripura Board", label: "Tripura Board" },
      { value: "UP Board", label: "Uttar Pradesh Board" },
      { value: "Uttarakhand Board", label: "Uttarakhand Board" },
      { value: "West Bengal Board", label: "West Bengal Board" },
    ],
  },
  {
    label: "International Boards",
    options: [
      { value: "IB", label: "IB (International Baccalaureate)" },
      { value: "IGCSE", label: "IGCSE / Cambridge" },
      { value: "Edexcel", label: "Edexcel / Pearson" },
    ],
  },
];

export const K12_GRADES: SelectOptionGroup[] = [
  {
    label: "Pre-Primary",
    options: [
      { value: "Nursery", label: "Nursery" },
      { value: "LKG", label: "LKG (Lower KG)" },
      { value: "UKG", label: "UKG (Upper KG)" },
    ],
  },
  {
    label: "Primary (1–5)",
    options: [
      { value: "1", label: "Grade 1" },
      { value: "2", label: "Grade 2" },
      { value: "3", label: "Grade 3" },
      { value: "4", label: "Grade 4" },
      { value: "5", label: "Grade 5" },
    ],
  },
  {
    label: "Middle (6–8)",
    options: [
      { value: "6", label: "Grade 6" },
      { value: "7", label: "Grade 7" },
      { value: "8", label: "Grade 8" },
    ],
  },
  {
    label: "Secondary (9–10)",
    options: [
      { value: "9", label: "Grade 9" },
      { value: "10", label: "Grade 10" },
    ],
  },
  {
    label: "Senior Secondary (11–12)",
    options: [
      { value: "11", label: "Grade 11" },
      { value: "12", label: "Grade 12" },
    ],
  },
];

export const K12_LANGUAGES: SelectOption[] = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "mr", label: "Marathi" },
  { value: "ta", label: "Tamil" },
  { value: "te", label: "Telugu" },
  { value: "kn", label: "Kannada" },
  { value: "bn", label: "Bengali" },
  { value: "gu", label: "Gujarati" },
  { value: "pa", label: "Punjabi" },
  { value: "ml", label: "Malayalam" },
  { value: "ur", label: "Urdu" },
  { value: "or", label: "Odia" },
];

export function getBoardLabel(value: string): string {
  const trimmed = value.trim();
  for (const group of K12_BOARDS) {
    const found = group.options.find(
      (o) => o.value.toLowerCase() === trimmed.toLowerCase()
    );
    if (found) return found.label;
  }
  return value;
}

export function getGradeLabel(value: string): string {
  const trimmed = value.trim();
  for (const group of K12_GRADES) {
    const found = group.options.find(
      (o) => o.value.toLowerCase() === trimmed.toLowerCase()
    );
    if (found) return found.label;
  }
  const num = parseInt(trimmed, 10);
  if (!isNaN(num)) return `Grade ${num}`;
  return value;
}

export function getLanguageLabel(value: string): string {
  const trimmed = value.trim();
  const found = K12_LANGUAGES.find(
    (o) => o.value.toLowerCase() === trimmed.toLowerCase()
  );
  return found ? found.label : value;
}
