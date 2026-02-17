"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface BackButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label?: string;
}

/**
 * Reusable back-navigation button.
 * Extracted from MessageViewer — uses Button variant="outline" size="sm".
 */
const BackButton = React.forwardRef<HTMLButtonElement, BackButtonProps>(
  ({ className, label = "Back", onClick, ...props }, ref) => {
    return (
      <Button
        ref={ref}
        variant="outline"
        size="sm"
        onClick={onClick}
        className={cn("cursor-pointer", className)}
        {...props}
      >
        <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        {label}
      </Button>
    );
  },
);

BackButton.displayName = "BackButton";

export { BackButton };
