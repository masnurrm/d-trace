'use client';

import { Eye, EyeOff } from 'lucide-react';
import {
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils/cn';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from './combobox';
import { InputGroupAddon } from './input-group';

/** The colour mark beside a choice, sized to sit on a text baseline. */
function Dot({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2 shrink-0 rounded-full', className)}
    />
  );
}

const controlClasses =
  'w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:outline-2 focus:outline-offset-0 focus:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500';

const borderClasses = (invalid: boolean) =>
  invalid
    ? 'border-red-400 dark:border-red-500'
    : 'border-slate-300 dark:border-slate-700';

interface FieldShellProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

/**
 * Label, control, hint and error as one unit.
 *
 * The ids are wired with `aria-describedby` / `aria-invalid` here so no screen
 * can forget them: an error a sighted user sees but a screen reader does not
 * announce is an error the form does not really report.
 */
function FieldShell({ id, label, hint, error, children }: FieldShellProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string;
  /** Decoration inside the control, before the text. Pass an element, not a component. */
  leadingIcon?: ReactNode;
  /** Decoration — or a control such as a reveal toggle — inside the control, after the text. */
  trailingIcon?: ReactNode;
}

export function TextField({
  label,
  hint,
  error,
  className,
  leadingIcon,
  trailingIcon,
  ...props
}: TextFieldProps) {
  const generatedId = useId();
  const id = props.name ? `field-${props.name}` : generatedId;

  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <div className="relative">
        {leadingIcon && (
          // Decorative, and `pointer-events-none` so a click on it still lands
          // on the input underneath.
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 flex w-10 items-center justify-center text-slate-400"
          >
            {leadingIcon}
          </span>
        )}
        <input
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={cn(
            controlClasses,
            borderClasses(Boolean(error)),
            leadingIcon && 'pl-10',
            trailingIcon && 'pr-10',
            className,
          )}
          {...props}
        />
        {trailingIcon && (
          <span className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400">
            {trailingIcon}
          </span>
        )}
      </div>
    </FieldShell>
  );
}

export type PasswordFieldProps = Omit<TextFieldProps, 'type' | 'trailingIcon'>;

/**
 * A TextField that can reveal what it holds. The toggle is a real button with
 * an accessible name, but it is kept out of the tab order so Tab still goes
 * from the password field straight to submit.
 */
export function PasswordField(props: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const Icon = revealed ? EyeOff : Eye;

  return (
    <TextField
      {...props}
      type={revealed ? 'text' : 'password'}
      trailingIcon={
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setRevealed((value) => !value)}
          aria-label={revealed ? 'Sembunyikan password' : 'Tampilkan password'}
          className="flex h-full w-full items-center justify-center rounded-r-lg text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-200"
        >
          <Icon className="h-4 w-4" aria-hidden />
        </button>
      }
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
  /**
   * A background utility class for a small dot drawn before the label — the
   * status of a project, the tone of a state. It is shown both in the list and
   * beside the closed control, because a colour that disappears once you choose
   * it only helps while you are choosing.
   */
  dot?: string;
}

export interface SelectFieldProps {
  label: string;
  hint?: string;
  error?: string;
  options: SelectOption[];
  placeholder?: string;
  value?: string;
  /**
   * Receives the option's value, or '' when cleared - not a change event.
   * A combobox has no single input whose `target.value` is the answer.
   */
  onValueChange?: (value: string) => void;
  name?: string;
  disabled?: boolean;
  className?: string;
  emptyMessage?: string;
  /**
   * Offer the clear button once something is chosen. Off for a choice that
   * always has an answer, where clearing would only produce an invalid one.
   */
  clearable?: boolean;
}

export interface SelectControlProps
  extends Omit<SelectFieldProps, 'label' | 'hint' | 'error'> {
  id?: string;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

/**
 * The searchable dropdown itself, with no label or error slot around it.
 *
 * Split out so the inline choosers - rows per page, a role in a table cell -
 * get the same control as a form field without inheriting a field's layout.
 */
export function SelectControl({
  options,
  placeholder,
  value,
  onValueChange,
  name,
  disabled,
  className,
  emptyMessage = 'Tidak ada yang cocok.',
  clearable = true,
  id,
  ...aria
}: SelectControlProps) {
  // The control is driven by the option object, but callers speak in values -
  // they should not have to hold the option list twice.
  const selected = options.find((option) => option.value === value) ?? null;

  return (
    <Combobox
      items={options}
      value={selected}
      onValueChange={(option) => onValueChange?.(option?.value ?? '')}
      itemToStringLabel={(option) => option.label}
      itemToStringValue={(option) => option.value}
      isItemEqualToValue={(a, b) => a.value === b.value}
      name={name}
      disabled={disabled}
    >
      <ComboboxInput
        id={id}
        placeholder={placeholder}
        disabled={disabled}
        showClear={clearable && selected !== null}
        className={cn('w-full', className)}
        {...aria}
      >
        {selected?.dot && (
          <InputGroupAddon align="inline-start">
            <Dot className={selected.dot} />
          </InputGroupAddon>
        )}
      </ComboboxInput>
      <ComboboxContent>
        <ComboboxEmpty>{emptyMessage}</ComboboxEmpty>
        <ComboboxList>
          {(option: SelectOption) => (
            <ComboboxItem key={option.value} value={option}>
              {option.dot && <Dot className={option.dot} />}
              {option.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

/**
 * Every choice in this app is a searchable dropdown.
 *
 * Built on the shadcn combobox rather than a native `<select>`: filtering is
 * the point, and a list of twenty-five audit actions or a hundred users is not
 * something anyone should scroll. The trade is that touch devices lose the
 * native picker, which is a deliberate, app-wide call.
 */
export function SelectField({ label, hint, error, name, ...control }: SelectFieldProps) {
  const generatedId = useId();
  const id = name ? `field-${name}` : generatedId;

  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <SelectControl
        {...control}
        id={id}
        name={name}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
      />
    </FieldShell>
  );
}

export interface TextareaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string;
}

export function TextareaField({ label, hint, error, className, ...props }: TextareaFieldProps) {
  const generatedId = useId();
  const id = props.name ? `field-${props.name}` : generatedId;

  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <textarea
        id={id}
        rows={3}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(controlClasses, borderClasses(Boolean(error)), 'resize-y', className)}
        {...props}
      />
    </FieldShell>
  );
}
