import { useEffect, useLayoutEffect, useRef } from "react";
import type {
  CSSProperties,
  DialogHTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
} from "react";
import { select } from "../styles/ui";

// Matches the option height, list padding, and option padding plus
// checkmark width in app.css.
const OPTION_HEIGHT = 32;
const LIST_PADDING = 8;
const OPTION_CHROME = 48;

// Choose the side the list opens on before it opens, so the CSS can square
// the corners where the button and the list meet.
function chooseDropDirection(element: HTMLSelectElement) {
  const rect = element.getBoundingClientRect();
  const needed = element.options.length * OPTION_HEIGHT + LIST_PADDING;
  const below = window.innerHeight - rect.bottom;
  element.dataset.drop = below < needed && rect.top > below ? "up" : "down";
}

// The open list is as wide as the button, so the button must fit the longest
// option. Options are measured in the bold weight used for the checked one.
function fitLongestOption(element: HTMLSelectElement) {
  if (!CSS.supports("appearance", "base-select")) return;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return;
  const style = getComputedStyle(element);
  context.font = `600 ${style.fontSize} ${style.fontFamily}`;
  const widest = Math.max(
    0,
    ...Array.from(
      element.options,
      (option) => context.measureText(option.text).width,
    ),
  );
  element.style.setProperty(
    "--fit-width",
    `${Math.ceil(widest + OPTION_CHROME)}px`,
  );
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const ref = useRef<HTMLSelectElement>(null);
  useLayoutEffect(() => {
    if (ref.current) fitLongestOption(ref.current);
  }, [children]);
  return (
    <select
      {...props}
      ref={ref}
      className={`${select} ${className ?? ""}`}
      onPointerDown={(event) => chooseDropDirection(event.currentTarget)}
      onKeyDown={(event) => chooseDropDirection(event.currentTarget)}
    >
      {children}
    </select>
  );
}

type SliderProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  min: number;
  max: number;
  value: number;
  vertical?: boolean;
};

export function Slider({ vertical, className, ...props }: SliderProps) {
  const span = props.max - props.min;
  const fill = span > 0 ? ((props.value - props.min) / span) * 100 : 0;
  return (
    <input
      {...props}
      type="range"
      className={`${vertical ? "vertical" : ""} ${className ?? ""}`}
      style={{ "--fill": `${fill}%` } as CSSProperties}
    />
  );
}

type ToggleProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export function Toggle({ className, ...props }: ToggleProps) {
  return (
    <span className={`relative inline-flex shrink-0 ${className ?? ""}`}>
      <input
        {...props}
        type="checkbox"
        role="switch"
        className="peer h-[31px] w-[51px] cursor-pointer appearance-none rounded-full bg-fill transition-colors checked:bg-success disabled:cursor-default disabled:opacity-40 forced-colors:appearance-auto"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-0.5 left-0.5 size-[27px] rounded-full bg-white shadow-control transition-transform peer-checked:translate-x-5 forced-colors:hidden"
      />
    </span>
  );
}

type SheetProps = Omit<DialogHTMLAttributes<HTMLDialogElement>, "onCancel"> & {
  onClose: () => void;
  narrow?: boolean;
};

// A modal sheet. It opens on mount; the parent closes it by unmounting it.
export function Sheet({ onClose, narrow, className, ...props }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      {...props}
      ref={ref}
      className={`m-auto max-h-[calc(100vh-48px)] ${narrow ? "w-[min(300px,calc(100vw-32px))]" : "w-[min(520px,calc(100vw-32px))]"} flex-col overflow-hidden rounded-[14px] border-0 bg-app p-0 text-ink shadow-control backdrop:bg-black/40 open:flex ${className ?? ""}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    />
  );
}

// An alert that asks the user to confirm a destructive action. The webview
// does not show window.confirm, so the app draws its own.
export function ConfirmAlert({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const button =
    "min-h-11 flex-1 cursor-pointer border-0 bg-transparent text-[17px]";
  return (
    <Sheet
      narrow
      role="alertdialog"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      onClose={onCancel}
    >
      <div className="px-4 pt-5 pb-4 text-center">
        <h2 className="m-0 text-[17px] font-semibold" id="confirm-title">
          {title}
        </h2>
        <p className="mt-1 mb-0 text-[13px]" id="confirm-message">
          {message}
        </p>
      </div>
      <div className="flex divide-x divide-separator border-t border-separator">
        <button
          className={`${button} text-accent`}
          type="button"
          autoFocus
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className={`${button} font-semibold text-danger`}
          type="button"
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}
