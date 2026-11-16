import { useEffect, useId, useRef } from "react";

const modalStack = [];

/** Shared centered overlay for short and medium operational tasks. */
export function Modal({
  title,
  description,
  onClose,
  children,
  className = "",
  size = "medium",
  closeOnBackdrop = true,
  canDismiss = true,
}) {
  const titleId = useId();
  const descriptionId = useId();
  const surfaceRef = useRef(null);
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const canDismissRef = useRef(canDismiss);
  const instanceRef = useRef(Symbol("modal"));
  onCloseRef.current = onClose;
  canDismissRef.current = canDismiss;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    modalStack.push(instanceRef.current);
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const handleKeyDown = (event) => {
      if (modalStack[modalStack.length - 1] !== instanceRef.current) return;
      if (event.key === "Escape" && canDismissRef.current) {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(surfaceRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) || [])].filter((node) => node.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) {
        event.preventDefault();
        surfaceRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      const index = modalStack.lastIndexOf(instanceRef.current);
      if (index >= 0) modalStack.splice(index, 1);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (closeOnBackdrop && canDismissRef.current && event.target === event.currentTarget) onCloseRef.current?.();
      }}
    >
      <section
        ref={surfaceRef}
        className={`modal-surface modal-size-${size} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="modal-header">
          <div className="modal-heading">
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            className="modal-close"
            onClick={() => canDismissRef.current && onCloseRef.current?.()}
            aria-label="Close dialog"
            aria-disabled={!canDismiss}
          >
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
