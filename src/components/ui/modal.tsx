"use client";

import { useEffect, useCallback } from "react";

type ModalSize = "sm" | "md" | "lg" | "xl" | "2xl";

interface ModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Modal title */
  title: string;
  /** Optional subtitle/description */
  subtitle?: string;
  /** Modal content */
  children: React.ReactNode;
  /** Footer content (buttons) */
  footer?: React.ReactNode;
  /** Modal size - affects max-width */
  size?: ModalSize;
  /** Whether to allow closing by clicking backdrop */
  closeOnBackdropClick?: boolean;
  /** Whether to allow closing by pressing Escape */
  closeOnEscape?: boolean;
}

const sizeClasses: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
};

/**
 * Reusable Modal component with consistent styling and behavior.
 * 
 * Features:
 * - Click outside to close (configurable)
 * - Escape key to close (configurable)
 * - Consistent header with title/subtitle and close button
 * - Responsive sizing
 * - Body scroll lock when open
 */
export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "md",
  closeOnBackdropClick = true,
  closeOnEscape = true,
}: ModalProps) {
  // Handle escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (closeOnEscape && e.key === "Escape") {
        onClose();
      }
    },
    [closeOnEscape, onClose]
  );

  // Add/remove escape key listener and body scroll lock
  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={closeOnBackdropClick ? onClose : undefined}
    >
      <div
        className={`bg-white rounded-2xl shadow-xl w-full ${sizeClasses[size]}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{title}</h2>
            {subtitle && (
              <p className="text-sm text-slate-500">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 cursor-pointer transition-colors"
            aria-label="Close modal"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="flex justify-end gap-3 px-6 pb-6">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Standard modal footer with Cancel and Submit buttons.
 * Use this for consistency across form modals.
 */
export function ModalFooter({
  onCancel,
  onSubmit,
  submitLabel = "Save",
  cancelLabel = "Cancel",
  isSubmitting = false,
  isDisabled = false,
  submitVariant = "primary",
}: {
  onCancel: () => void;
  onSubmit?: () => void;
  submitLabel?: string;
  cancelLabel?: string;
  isSubmitting?: boolean;
  isDisabled?: boolean;
  submitVariant?: "primary" | "danger";
}) {
  const submitClasses =
    submitVariant === "danger"
      ? "bg-red-500 hover:bg-red-600 text-white"
      : "bg-teal-500 hover:bg-teal-600 text-white";

  return (
    <>
      <button
        type="button"
        onClick={onCancel}
        disabled={isSubmitting}
        className="px-4 py-2 rounded-xl border-2 border-slate-200 text-slate-700 font-semibold hover:bg-slate-50 disabled:opacity-50 transition-colors cursor-pointer"
      >
        {cancelLabel}
      </button>
      {onSubmit && (
        <button
          type="submit"
          onClick={onSubmit}
          disabled={isSubmitting || isDisabled}
          className={`px-4 py-2 rounded-xl font-semibold disabled:opacity-50 transition-colors cursor-pointer ${submitClasses}`}
        >
          {isSubmitting ? "Saving..." : submitLabel}
        </button>
      )}
    </>
  );
}

/**
 * Form input field with label and optional error message.
 * Use this for consistency across form fields in modals.
 */
export function FormField({
  label,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && !error && (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      )}
      {error && (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}

/**
 * Standard text input with consistent styling.
 */
export function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  disabled,
  hasError,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "email" | "tel";
  disabled?: boolean;
  hasError?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type">) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={`w-full px-4 py-2.5 rounded-xl border-2 ${
        hasError
          ? "border-red-300 focus:border-red-500 focus:ring-red-500/20"
          : "border-slate-200 focus:border-teal-500 focus:ring-teal-500/20"
      } focus:outline-none focus:ring-2 transition-colors`}
      {...props}
    />
  );
}
