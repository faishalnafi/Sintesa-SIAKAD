import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

export interface ModalProps {
  isOpen: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  className?: string;
  backdropClassName?: string;
  closeOnBackdropClick?: boolean;
}

/**
 * Global Portal Modal Component
 * 
 * Renders into document.body with z-[999] ensuring full-screen dimming overlay
 * that covers sticky headers, sidebars, and toggle buttons.
 * Automatically locks document.body scroll and handles ESC key.
 */
export function Modal({
  isOpen,
  onClose,
  children,
  className,
  backdropClassName,
  closeOnBackdropClick = true,
}: ModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-fadeIn",
        backdropClassName
      )}
      onClick={(e) => {
        if (closeOnBackdropClick && e.target === e.currentTarget && onClose) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
    >
      {className ? <div className={className}>{children}</div> : children}
    </div>,
    document.body
  );
}
