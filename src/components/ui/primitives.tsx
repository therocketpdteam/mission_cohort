"use client";

import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactElement,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes
} from "react";
import { Children, cloneElement, forwardRef, isValidElement, useEffect, useMemo, useRef, useState } from "react";

function clsx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

type SxValue = Record<string, any>;

const spacing = 8;

function size(value: unknown) {
  return typeof value === "number" ? `${value}px` : value;
}

function responsive(value: any) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value.xs ?? value.sm ?? value.md ?? value.lg ?? value.xl;
  }
  return value;
}

function color(value: any) {
  const resolved = responsive(value);
  if (resolved === "background.default") return "var(--color-slate-50)";
  if (resolved === "background.paper") return "var(--color-white)";
  if (resolved === "text.secondary") return "var(--color-slate-500)";
  if (resolved === "divider") return "var(--color-slate-200)";
  if (resolved === "primary.main") return "var(--color-blue-600)";
  if (resolved === "primary.light") return "var(--color-blue-100)";
  if (resolved === "success.light") return "var(--color-success-100)";
  if (resolved === "success.dark") return "var(--color-success-600)";
  if (resolved === "warning.light") return "var(--color-warning-100)";
  if (resolved === "warning.dark") return "var(--color-warning-600)";
  if (resolved === "error.light") return "var(--color-danger-100)";
  if (resolved === "error.dark") return "var(--color-danger-600)";
  return resolved;
}

export function sxToStyle(sx?: SxValue | SxValue[] | null): CSSProperties {
  const source = Array.isArray(sx) ? Object.assign({}, ...sx.filter(Boolean)) : sx ?? {};
  const style: CSSProperties = {};

  for (const [key, raw] of Object.entries(source)) {
    if (key.startsWith("&") || key.startsWith("@")) continue;
    const value = responsive(raw);
    if (value == null) continue;

    if (key === "p") style.padding = Number(value) * spacing;
    else if (key === "px") {
      style.paddingLeft = Number(value) * spacing;
      style.paddingRight = Number(value) * spacing;
    } else if (key === "py") {
      style.paddingTop = Number(value) * spacing;
      style.paddingBottom = Number(value) * spacing;
    } else if (key === "pt") style.paddingTop = Number(value) * spacing;
    else if (key === "pb") style.paddingBottom = Number(value) * spacing;
    else if (key === "pl") style.paddingLeft = Number(value) * spacing;
    else if (key === "pr") style.paddingRight = Number(value) * spacing;
    else if (key === "m") style.margin = Number(value) * spacing;
    else if (key === "mx") {
      style.marginLeft = value === "auto" ? "auto" : Number(value) * spacing;
      style.marginRight = value === "auto" ? "auto" : Number(value) * spacing;
    } else if (key === "my") {
      style.marginTop = Number(value) * spacing;
      style.marginBottom = Number(value) * spacing;
    } else if (key === "mt") style.marginTop = Number(value) * spacing;
    else if (key === "mb") style.marginBottom = Number(value) * spacing;
    else if (key === "ml") style.marginLeft = value === "auto" ? "auto" : Number(value) * spacing;
    else if (key === "mr") style.marginRight = value === "auto" ? "auto" : Number(value) * spacing;
    else if (key === "bgcolor") style.backgroundColor = color(value);
    else if (key === "borderColor") style.borderColor = color(value);
    else if (key === "border" && value) style.border = "1px solid var(--color-slate-200)";
    else if (key === "borderTop" && value) style.borderTop = "1px solid var(--color-slate-200)";
    else if (key === "borderBottom" && value) style.borderBottom = "1px solid var(--color-slate-200)";
    else if (key === "borderRadius") style.borderRadius = Number(value) * 8;
    else if (key === "color") style.color = color(value);
    else if (key === "gap" || key === "columnGap" || key === "rowGap") (style as any)[key] = Number(value) * spacing;
    else if (key === "width" || key === "height" || key === "minWidth" || key === "maxWidth" || key === "minHeight" || key === "maxHeight") {
      (style as any)[key] = size(value);
    } else if (key === "display" || key === "alignItems" || key === "justifyContent" || key === "flexGrow" || key === "flexShrink" || key === "flex" || key === "position" || key === "inset" || key === "overflow" || key === "overflowX" || key === "overflowY" || key === "textAlign" || key === "whiteSpace" || key === "lineHeight" || key === "fontWeight" || key === "fontSize" || key === "textTransform" || key === "aspectRatio" || key === "gridTemplateColumns" || key === "placeItems" || key === "cursor") {
      (style as any)[key] = value;
    }
  }

  return style;
}

type BaseProps = {
  component?: any;
  sx?: SxValue | SxValue[];
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  onClick?: (event: any) => void;
  onSubmit?: (event: any) => void;
  [key: string]: any;
};

export function Box({ component: Component = "div", sx, className, ...props }: BaseProps) {
  return <Component className={className} style={{ ...sxToStyle(sx), ...(props.style ?? {}) }} {...props} />;
}

export function Stack({
  component: Component = "div",
  direction = "column",
  spacing = 0,
  gap,
  flexWrap,
  useFlexGap: _useFlexGap,
  alignItems,
  justifyContent,
  sx,
  className,
  ...props
}: BaseProps & {
  direction?: any;
  spacing?: any;
  gap?: any;
  flexWrap?: CSSProperties["flexWrap"];
  useFlexGap?: boolean;
  alignItems?: CSSProperties["alignItems"] | Record<string, CSSProperties["alignItems"]>;
  justifyContent?: CSSProperties["justifyContent"] | Record<string, CSSProperties["justifyContent"]>;
}) {
  return (
    <Component
      className={clsx("ui-stack", className)}
      style={{
        flexDirection: responsive(direction),
        gap: Number(gap ?? spacing ?? 0) * spacingUnit,
        flexWrap,
        alignItems: responsive(alignItems),
        justifyContent: responsive(justifyContent),
        ...sxToStyle(sx),
        ...(props.style ?? {})
      }}
      {...props}
    />
  );
}

const spacingUnit = 8;

export function Grid({ container, spacing = 0, size: _size, sx, className, alignItems, justifyContent, ...props }: BaseProps & { container?: boolean; spacing?: any; size?: any; alignItems?: any; justifyContent?: any }) {
  return (
    <div
      className={clsx(container ? "ui-grid" : "ui-grid-item", className)}
      style={{
        gap: container ? Number(spacing) * spacingUnit : undefined,
        alignItems,
        justifyContent,
        ...sxToStyle(sx),
        ...(props.style ?? {})
      }}
      {...props}
    />
  );
}

export function Typography({
  variant = "body1",
  color: textColor,
  fontWeight,
  noWrap,
  display,
  sx,
  className,
  children,
  ...props
}: BaseProps & {
  variant?: string;
  color?: string;
  fontWeight?: CSSProperties["fontWeight"];
  noWrap?: boolean;
  display?: CSSProperties["display"];
}) {
  const Component: any = ["h1", "h2", "h3", "h4"].includes(variant) ? variant : "p";
  return (
    <Component
      className={clsx("ui-text", `ui-text-${variant}`, noWrap && "ui-nowrap", className)}
      style={{ color: color(textColor), fontWeight, display, ...sxToStyle(sx), ...(props.style ?? {}) }}
      {...props}
    >
      {children}
    </Component>
  );
}

export function Button({
  variant = "contained",
  color: tone,
  size,
  startIcon,
  endIcon,
  disabled,
  className,
  children,
  sx,
  href,
  component,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "contained" | "outlined" | "text";
  color?: "primary" | "secondary" | "success" | "warning" | "error" | "inherit";
  size?: "small" | "medium";
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  sx?: SxValue | SxValue[];
  href?: string;
  component?: any;
  fullWidth?: boolean;
  [key: string]: any;
}) {
  const classes = clsx("ui-button", `ui-button-${variant}`, tone && `ui-button-${tone}`, size === "small" && "ui-button-small", className);
  const content = (
    <>
      {startIcon && <span className="ui-button-icon">{startIcon}</span>}
      <span>{children}</span>
      {endIcon && <span className="ui-button-icon">{endIcon}</span>}
    </>
  );

  if (href || component) {
    const Component = component ?? "a";
    return (
      <Component href={href} className={classes} aria-disabled={disabled} style={sxToStyle(sx)} {...props}>
        {content}
      </Component>
    );
  }

  return (
    <button className={classes} disabled={disabled} style={sxToStyle(sx)} {...props}>
      {content}
    </button>
  );
}

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { size?: "small" | "medium"; color?: string; sx?: SxValue | SxValue[] }>(function IconButton({
  size,
  color: tone,
  className,
  sx,
  children,
  ...props
}, ref) {
  return (
    <button ref={ref} className={clsx("ui-icon-button", size === "small" && "ui-icon-button-small", tone && `ui-icon-${tone}`, className)} style={sxToStyle(sx)} {...props}>
      {children}
    </button>
  );
});

export function TextField({
  label,
  select,
  children,
  multiline,
  minRows,
  fullWidth,
  helperText,
  sx,
  className,
  InputLabelProps: _InputLabelProps,
  ...props
}: {
  label?: string;
  select?: boolean;
  multiline?: boolean;
  minRows?: number;
  fullWidth?: boolean;
  helperText?: ReactNode;
  sx?: SxValue | SxValue[];
  InputLabelProps?: any;
  inputProps?: any;
  onChange?: (event: any) => void;
  children?: ReactNode;
  className?: string;
  [key: string]: any;
}) {
  const id = props.id ?? (label ? String(label).toLowerCase().replace(/\W+/g, "-") : undefined);
  const selectValue = props.value == null ? "" : String(props.value);
  const selectOptions = Children.toArray(children)
    .filter(isValidElement)
    .map((child: any) => ({
      value: child.props.value == null ? "" : String(child.props.value),
      label: child.props.label ?? child.props.children,
      menuLabel: child.props.children,
      disabled: child.props.disabled
    }));
  const selectedOption = selectOptions.find((option) => option.value === selectValue) ?? selectOptions[0];
  const [selectOpen, setSelectOpen] = useState(false);
  const selectRef = useRef<HTMLLabelElement>(null);

  useEffect(() => {
    function close(event: MouseEvent) {
      if (!selectRef.current?.contains(event.target as Node)) {
        setSelectOpen(false);
      }
    }

    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function selectOption(value: string) {
    const event = { target: { value }, currentTarget: { value } };
    props.onChange?.(event);
    setSelectOpen(false);
  }

  return (
    <label className={clsx("ui-field", fullWidth && "ui-field-full", className)} style={sxToStyle(sx)} ref={select ? selectRef : undefined}>
      {label && <span className="ui-label">{label}</span>}
      {select ? (
        <span className="ui-select">
          <button
            type="button"
            id={id}
            className="ui-input ui-select-trigger"
            disabled={props.disabled}
            aria-expanded={selectOpen}
            onClick={() => setSelectOpen((current) => !current)}
          >
            <span>{selectedOption?.label ?? "Select"}</span>
            <span aria-hidden="true">⌄</span>
          </button>
          <input type="hidden" name={props.name} value={selectValue} required={props.required} />
          {selectOpen && (
            <span className="ui-select-menu">
              {selectOptions.map((option) => (
                <button
                  type="button"
                  className={clsx("ui-select-option", option.value === selectValue && "is-selected")}
                  key={option.value}
                  disabled={option.disabled}
                  onClick={() => selectOption(option.value)}
                >
                  {option.menuLabel}
                </button>
              ))}
            </span>
          )}
        </span>
      ) : multiline ? (
        <textarea id={id} className="ui-input ui-textarea" rows={minRows} {...(props as TextareaHTMLAttributes<HTMLTextAreaElement>)} />
      ) : (
        <input
          id={id}
          className="ui-input"
          {...(props as InputHTMLAttributes<HTMLInputElement>)}
          lang={props.type === "date" || props.type === "datetime-local" ? "en-US" : props.lang}
        />
      )}
      {helperText && <span className="ui-helper">{helperText}</span>}
    </label>
  );
}

export function MenuItem({ value, children, disabled, onClick, className, sx, label: _label, ...props }: HTMLAttributes<HTMLDivElement> & { value?: string | number; disabled?: boolean; sx?: SxValue | SxValue[]; label?: ReactNode }) {
  return (
    <option value={value} disabled={disabled} className={className} {...(props as any)}>
      {children}
    </option>
  );
}

export function Alert({ severity = "info", children, className, sx, ...props }: BaseProps & { severity?: "success" | "error" | "warning" | "info" }) {
  return (
    <div role="alert" className={clsx("ui-alert", `ui-alert-${severity}`, className)} style={sxToStyle(sx)} {...props}>
      {children}
    </div>
  );
}

export function Snackbar({ open, children, message, action }: { open: boolean; autoHideDuration?: number; onClose?: () => void; children?: ReactNode; message?: ReactNode; action?: ReactNode }) {
  if (!open) return null;
  return <div className="ui-toast-region">{children ?? <Alert severity="success">{message}{action}</Alert>}</div>;
}

export function Card({ children, className, sx, ...props }: BaseProps) {
  return (
    <section className={clsx("ui-card", className)} style={sxToStyle(sx)} {...props}>
      {children}
    </section>
  );
}

export function CardContent({ children, className, sx, ...props }: BaseProps) {
  return (
    <div className={clsx("ui-card-content", className)} style={sxToStyle(sx)} {...props}>
      {children}
    </div>
  );
}

export function Paper({ children, className, sx, ...props }: BaseProps & { variant?: string }) {
  return (
    <div className={clsx("ui-paper", className)} style={sxToStyle(sx)} {...props}>
      {children}
    </div>
  );
}

export function Divider({ sx, className, ...props }: BaseProps) {
  return <hr className={clsx("ui-divider", className)} style={sxToStyle(sx)} {...props} />;
}

export function Dialog({ open, children, onClose, maxWidth = "md", PaperProps }: { open: boolean; children: ReactNode; onClose?: () => void; fullWidth?: boolean; maxWidth?: "sm" | "md" | "lg" | string; PaperProps?: any }) {
  if (!open) return null;
  return (
    <div className="ui-modal-backdrop" onMouseDown={onClose}>
      <div
        className={clsx("ui-modal", `ui-modal-${maxWidth}`, PaperProps?.className)}
        style={{ ...sxToStyle(PaperProps?.sx), ...(PaperProps?.style ?? {}) }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function DialogTitle({ children, className, sx, ...props }: BaseProps) {
  return (
    <div className={clsx("ui-modal-header", className)} style={sxToStyle(sx)} {...props}>
      {children}
    </div>
  );
}

export function DialogContent({ children, className, sx, ...props }: BaseProps) {
  return (
    <div className={clsx("ui-modal-body", className)} style={sxToStyle(sx)} {...props}>
      {children}
    </div>
  );
}

export function DialogActions({ children, className, sx, ...props }: BaseProps) {
  return (
    <div className={clsx("ui-modal-footer", className)} style={sxToStyle(sx)} {...props}>
      {children}
    </div>
  );
}

export function Tooltip({ title, children }: { title: ReactNode; children: ReactNode }) {
  if (isValidElement(children)) {
    return cloneElement(children as ReactElement<any>, { title: typeof title === "string" ? title : undefined });
  }
  return <>{children}</>;
}

export function CircularProgress({ size = 24 }: { size?: number }) {
  return <span className="ui-spinner" style={{ width: size, height: size }} />;
}

export function Chip({ label, color: tone, size }: { label: ReactNode; color?: "success" | "primary" | "warning" | "error"; size?: "small" }) {
  return <span className={clsx("ui-chip", tone && `ui-chip-${tone}`, size === "small" && "ui-chip-small")}>{label}</span>;
}

export function Switch({ checked, onChange }: { checked?: boolean; onChange?: (event: { target: { checked: boolean } }) => void }) {
  return <input type="checkbox" className="ui-switch" checked={checked} onChange={(event) => onChange?.({ target: { checked: event.target.checked } })} />;
}

export function FormControlLabel({ control, label }: { control: ReactNode; label: ReactNode }) {
  return (
    <label className="ui-check-row">
      {control}
      <span>{label}</span>
    </label>
  );
}

export function Autocomplete<T>({
  options,
  value,
  onChange,
  getOptionLabel,
  renderInput,
  isOptionEqualToValue: _isOptionEqualToValue,
  onInputChange,
  inputValue: _inputValue,
  sx: _sx
}: {
  options: T[];
  value?: T | null;
  onChange?: (_event: unknown, value: T | null) => void;
  getOptionLabel?: (option: T) => string;
  renderInput?: (params: any) => ReactNode;
  isOptionEqualToValue?: (option: T, value: T) => boolean;
  onInputChange?: (...args: any[]) => void;
  inputValue?: string;
  sx?: SxValue | SxValue[];
}) {
  const labelElement = renderInput?.({});
  const label = isValidElement(labelElement) ? (labelElement.props as any).label : undefined;
  const labels = useMemo(() => options.map((option) => getOptionLabel?.(option) ?? String(option)), [getOptionLabel, options]);
  const currentIndex = value ? options.findIndex((option) => option === value || (getOptionLabel?.(option) ?? String(option)) === (getOptionLabel?.(value) ?? String(value))) : -1;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLLabelElement>(null);

  useEffect(() => {
    function close(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function choose(index: number) {
    const nextValue = options[index] ?? null;
    onChange?.({ target: { value: String(index) } }, nextValue);
    onInputChange?.(null, nextValue ? labels[index] : "", "selectOption");
    setOpen(false);
  }

  return (
    <label className="ui-field ui-field-full" ref={ref}>
      {label && <span className="ui-label">{label}</span>}
      <span className="ui-select">
        <button type="button" className="ui-input ui-select-trigger" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
          <span>{currentIndex >= 0 ? labels[currentIndex] : "Select"}</span>
          <span aria-hidden="true">⌄</span>
        </button>
        {open && (
          <span className="ui-select-menu">
            <button type="button" className={clsx("ui-select-option", currentIndex < 0 && "is-selected")} onClick={() => choose(-1)}>
              Select
            </button>
            {labels.map((optionLabel, index) => (
              <button
                type="button"
                className={clsx("ui-select-option", currentIndex === index && "is-selected")}
                key={`${optionLabel}-${index}`}
                onClick={() => choose(index)}
              >
                {optionLabel}
              </button>
            ))}
          </span>
        )}
      </span>
    </label>
  );
}

export function Stepper({ activeStep, children }: { activeStep: number; children: ReactNode; alternativeLabel?: boolean; sx?: SxValue }) {
  return <div className="ui-stepper">{Array.isArray(children) ? children.map((child, index) => isValidElement(child) ? cloneElement(child as ReactElement<any>, { active: index === activeStep, done: index < activeStep }) : child) : children}</div>;
}

export function Step({ children, active, done }: { children: ReactNode; active?: boolean; done?: boolean }) {
  return <div className={clsx("ui-step", active && "is-active", done && "is-done")}>{children}</div>;
}

export function StepLabel({ children }: { children: ReactNode }) {
  return <span>{children}</span>;
}

export function Tabs({ value, onChange, children }: { value: number; onChange?: (event: unknown, value: number) => void; children: ReactNode; variant?: string; scrollButtons?: string }) {
  return (
    <div className="ui-tabs">
      {Array.isArray(children) ? children.map((child, index) => isValidElement(child) ? cloneElement(child as ReactElement<any>, { active: value === index, onSelect: () => onChange?.(null, index) }) : child) : children}
    </div>
  );
}

export function Tab({ label, active, onSelect }: { label: ReactNode; active?: boolean; onSelect?: () => void }) {
  return <button type="button" className={clsx("ui-tab", active && "is-active")} onClick={onSelect}>{label}</button>;
}

export function List({ children, className, sx, ...props }: BaseProps & { dense?: boolean }) {
  return <div className={className} style={sxToStyle(sx)} {...props}>{children}</div>;
}

export function ListItem({ children, divider, className, sx, ...props }: BaseProps & { divider?: boolean }) {
  return <div className={clsx("ui-list-item", divider && "ui-list-item-divider", className)} style={sxToStyle(sx)} {...props}>{children}</div>;
}

export function ListItemText({ primary, secondary, children }: { primary?: ReactNode; secondary?: ReactNode; children?: ReactNode; primaryTypographyProps?: any; sx?: SxValue }) {
  return <div className="ui-list-text"><div>{primary ?? children}</div>{secondary && <small>{secondary}</small>}</div>;
}

export function Avatar({ children, sx }: { children: ReactNode; sx?: SxValue }) {
  return <span className="ui-avatar" style={sxToStyle(sx)}>{children}</span>;
}

export function Menu({ open, children }: { anchorEl?: HTMLElement | null; open: boolean; onClose?: () => void; children: ReactNode }) {
  if (!open) return null;
  return <div className="ui-menu">{children}</div>;
}

export function AppBar({ children, className, sx, ...props }: BaseProps) {
  return <header className={clsx("ui-appbar", className)} style={sxToStyle(sx)} {...props}>{children}</header>;
}

export function Toolbar({ children, className, sx, ...props }: BaseProps) {
  return <div className={clsx("ui-toolbar", className)} style={sxToStyle(sx)} {...props}>{children}</div>;
}

export function Breadcrumbs({ children, className, sx, ...props }: BaseProps & { maxItems?: number }) {
  return <nav className={clsx("ui-breadcrumbs", className)} style={sxToStyle(sx)} {...props}>{children}</nav>;
}

export function Drawer({ open, children }: { variant?: string; open?: boolean; onClose?: () => void; ModalProps?: any; sx?: SxValue; children: ReactNode }) {
  return open ? <aside>{children}</aside> : null;
}

export function Container({ children, className, sx, maxWidth: _maxWidth, ...props }: BaseProps & { maxWidth?: string }) {
  return <main className={clsx("page-stack", className)} style={sxToStyle(sx)} {...props}>{children}</main>;
}

export function Collapse({ in: open, children }: { in: boolean; children: ReactNode }) {
  return open ? <>{children}</> : null;
}

export function Accordion({ children, className, sx, ...props }: BaseProps) {
  return <section className={clsx("ui-card", className)} style={sxToStyle(sx)} {...props}>{children}</section>;
}

export function AccordionSummary({ children, className, sx, expandIcon: _expandIcon, ...props }: BaseProps & { expandIcon?: ReactNode }) {
  return <div className={clsx("section-card-header", className)} style={sxToStyle(sx)} {...props}>{children}</div>;
}

export function AccordionDetails({ children, className, sx, ...props }: BaseProps) {
  return <div className={clsx("ui-card-content", className)} style={sxToStyle(sx)} {...props}>{children}</div>;
}
