import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Convert phone to E.164 format, returns null if invalid
// Supports: (555) 123-4567, 555-123-4567, 5551234567, +15551234567, 1-555-123-4567
export function toE164(phone: string): string | null {
  const trimmed = phone.trim();
  if (!trimmed) return null;
  
  // Already in E.164 format
  if (/^\+[1-9]\d{9,14}$/.test(trimmed)) {
    return trimmed;
  }
  
  // Extract only digits
  const digits = trimmed.replace(/\D/g, "");
  
  // 10 digits (e.g., 5551234567) → assume US/Canada (+1)
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  
  // 11 digits starting with 1 (e.g., 15551234567) → US/Canada
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  
  // 11-15 digits not starting with 1 → add + prefix
  if (digits.length >= 11 && digits.length <= 15) {
    return `+${digits}`;
  }
  
  return null; // Invalid
}
