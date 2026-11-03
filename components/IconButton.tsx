import type { ButtonHTMLAttributes, ReactNode } from "react";

type Tone = "default" | "primary" | "danger" | "quiet";

const TONE: Record<Tone, string> = {
  default: "bg-paper-3 text-ink hover:bg-rule disabled:hover:bg-paper-3",
  primary: "bg-accent text-accent-ink hover:opacity-90",
  danger: "bg-danger text-paper",
  quiet: "text-ink-2 hover:bg-rule hover:text-ink disabled:hover:bg-transparent",
};

const SIZE = {
  md: "size-8 rounded-md",
  sm: "size-6 rounded",
} as const;

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> & {
  /** 読み上げとツールチップに使う。ボタンの意味が文字なしでも伝わるように必ず渡す。 */
  label: string;
  /** ツールチップだけに添える補足（ショートカットなど）。 */
  hint?: string;
  tone?: Tone;
  size?: keyof typeof SIZE;
  /** 右端に置くボタンは "end" にして、ツールチップが外へはみ出さないようにする。 */
  align?: "center" | "end";
  children: ReactNode;
};

/** 文字の代わりにアイコンを出すボタン。名前はホバー／フォーカス時のツールチップで示す。 */
export function IconButton({
  label,
  hint,
  tone = "default",
  size = "md",
  align = "center",
  className = "",
  type = "button",
  children,
  ...rest
}: Props) {
  return (
    <span className="group relative inline-flex">
      <button
        {...rest}
        type={type}
        aria-label={label}
        className={`inline-flex shrink-0 items-center justify-center transition-colors duration-(--dur-fast) disabled:cursor-not-allowed disabled:opacity-40 ${SIZE[size]} ${TONE[tone]} ${className}`}
      >
        {children}
      </button>
      <span
        aria-hidden
        // 非表示の間は display:none にして、親のスクロール領域を広げないようにする。
        className={`pointer-events-none absolute top-full z-20 mt-1 hidden rounded bg-ink px-2 py-1 text-xs whitespace-nowrap text-paper group-hover:block group-has-[:focus-visible]:block ${
          align === "end" ? "right-0" : "left-1/2 -translate-x-1/2"
        }`}
      >
        {label}
        {hint && <span className="ml-1 opacity-70">{hint}</span>}
      </span>
    </span>
  );
}

type IconProps = { className?: string };

function Svg({ className = "size-4", children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {children}
    </svg>
  );
}

export const UndoIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
  </Svg>
);
export const RedoIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9a5 5 0 0 0 0 10h3" />
  </Svg>
);
export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);
export const ExportIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 15V3" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 21h14" />
  </Svg>
);
export const StopIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="6" width="12" height="12" rx="1.5" />
  </Svg>
);
export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
  </Svg>
);
export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 5v14M16 5v14" strokeWidth={3} />
  </Svg>
);
export const NarratedPlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5v14l9-7z" fill="currentColor" />
    <path d="M16 9a4 4 0 0 1 0 6" />
    <path d="M19 6a8 8 0 0 1 0 12" />
  </Svg>
);
export const SpinnerIcon = ({ className = "size-4" }: IconProps) => (
  <Svg className={`animate-spin ${className}`}>
    <path d="M21 12a9 9 0 1 1-6.2-8.6" />
  </Svg>
);
export const SplitIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v18" />
    <path d="M8 8 4 12l4 4" />
    <path d="m16 8 4 4-4 4" />
  </Svg>
);
export const ZoomIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-4-4M11 8v6M8 11h6" />
  </Svg>
);
export const BlurIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="3 3" />
    <circle cx="9" cy="9" r="1" fill="currentColor" />
    <circle cx="15" cy="9" r="1" fill="currentColor" />
    <circle cx="9" cy="15" r="1" fill="currentColor" />
    <circle cx="15" cy="15" r="1" fill="currentColor" />
  </Svg>
);
export const TuneIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </Svg>
);
export const SparkleIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    <path d="M19 15v4M17 17h4" />
  </Svg>
);
export const MicIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Svg>
);
export const DictateIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="3" width="5" height="9" rx="2.5" />
    <path d="M2 10a4.5 4.5 0 0 0 9 0M6.5 15v2" />
    <path d="M14 7h7M14 12h7M9 19h12" />
  </Svg>
);
export const ReviewIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="m3 6 1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2" />
  </Svg>
);
export const CaptionAddIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M7 15h6M17 10v4M15 12h4" />
  </Svg>
);
export const ArrowUpIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Svg>
);
export const ArrowDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Svg>
);
export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Svg>
);
export const SpeakerIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9v6h4l5 4V5L8 9z" />
    <path d="M17 9a4 4 0 0 1 0 6" />
  </Svg>
);
