import { useState, useRef, useCallback } from "react";

type FieldErrors = {
  email?: string;
  phone_number?: string;
};

export function useUniquenessCheck(getAccessToken: () => Promise<string | null>) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isChecking, setIsChecking] = useState<{ email?: boolean; phone_number?: boolean }>({});
  const debounceTimers = useRef<{ email?: NodeJS.Timeout; phone_number?: NodeJS.Timeout }>({});
  const abortControllers = useRef<{ email?: AbortController; phone_number?: AbortController }>({});

  const checkField = useCallback(
    async (field: "email" | "phone_number", value: string) => {
      // Clear previous timer
      if (debounceTimers.current[field]) {
        clearTimeout(debounceTimers.current[field]);
      }

      // Abort previous request
      if (abortControllers.current[field]) {
        abortControllers.current[field]?.abort();
      }

      // Clear error immediately if value is empty
      if (!value.trim()) {
        setErrors((prev) => ({ ...prev, [field]: undefined }));
        setIsChecking((prev) => ({ ...prev, [field]: false }));
        return;
      }

      // For email, validate format first
      if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        setErrors((prev) => ({ ...prev, email: undefined }));
        setIsChecking((prev) => ({ ...prev, email: false }));
        return;
      }

      setIsChecking((prev) => ({ ...prev, [field]: true }));

      debounceTimers.current[field] = setTimeout(async () => {
        const controller = new AbortController();
        abortControllers.current[field] = controller;

        try {
          const token = await getAccessToken();
          if (!token) {
            setIsChecking((prev) => ({ ...prev, [field]: false }));
            return;
          }

          const res = await fetch("/api/admin/participants/check", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ [field]: value }),
            signal: controller.signal,
          });

          if (!res.ok) {
            setIsChecking((prev) => ({ ...prev, [field]: false }));
            return;
          }

          const data = await res.json();
          setErrors((prev) => ({
            ...prev,
            [field]: data.errors?.[field] || undefined,
          }));
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") {
            return; // Request was aborted, ignore
          }
          console.error("Uniqueness check failed:", err);
        } finally {
          setIsChecking((prev) => ({ ...prev, [field]: false }));
        }
      }, 400); // 400ms debounce
    },
    [getAccessToken]
  );

  const clearError = useCallback((field: "email" | "phone_number") => {
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    setIsChecking((prev) => ({ ...prev, [field]: false }));
    // Clear pending timer for this field
    if (debounceTimers.current[field]) {
      clearTimeout(debounceTimers.current[field]);
    }
    // Abort pending request for this field
    if (abortControllers.current[field]) {
      abortControllers.current[field]?.abort();
    }
  }, []);

  const clearAllErrors = useCallback(() => {
    setErrors({});
    setIsChecking({});
    // Clear any pending timers
    if (debounceTimers.current.email) clearTimeout(debounceTimers.current.email);
    if (debounceTimers.current.phone_number) clearTimeout(debounceTimers.current.phone_number);
  }, []);

  return { errors, isChecking, checkField, clearError, clearAllErrors };
}
