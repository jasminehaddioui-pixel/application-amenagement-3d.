import { useEffect, useState } from 'react';

interface NumberFieldProps {
  label?: string;
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  decimals?: number;
  disabled?: boolean;
}

/**
 * Champ numerique a validation differee : la saisie reste libre tant que
 * l'utilisateur tape, la valeur n'est appliquee qu'a la sortie du champ
 * ou sur Entree. Evite qu'une frappe intermediaire ne casse le modele.
 */
export function NumberField({
  label,
  value,
  onCommit,
  step = 0.01,
  min,
  max,
  unit,
  decimals = 2,
  disabled,
}: NumberFieldProps) {
  const [text, setText] = useState(() => value.toFixed(decimals));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setText(value.toFixed(decimals));
  }, [value, decimals, editing]);

  const commit = () => {
    setEditing(false);
    const raw = text.replace(',', '.').trim();
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      setText(value.toFixed(decimals));
      return;
    }
    let v = n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    setText(v.toFixed(decimals));
    if (Math.abs(v - value) > 1e-9) onCommit(v);
  };

  return (
    <div className="field">
      {label && <label>{label}{unit ? ` (${unit})` : ''}</label>}
      <input
        className="input"
        type="number"
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        value={text}
        onChange={(e) => {
          setEditing(true);
          setText(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setEditing(false);
            setText(value.toFixed(decimals));
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </div>
  );
}

interface TextFieldProps {
  label?: string;
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
}

export function TextField({ label, value, onCommit, placeholder }: TextFieldProps) {
  const [text, setText] = useState(value);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);

  return (
    <div className="field">
      {label && <label>{label}</label>}
      <input
        className="input"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setEditing(true);
          setText(e.target.value);
        }}
        onBlur={() => {
          setEditing(false);
          if (text !== value) onCommit(text);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}

interface SelectFieldProps<T extends string> {
  label?: string;
  value: T;
  options: Array<[T, string]>;
  onCommit: (v: T) => void;
}

export function SelectField<T extends string>({ label, value, options, onCommit }: SelectFieldProps<T>) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      <select className="input" value={value} onChange={(e) => onCommit(e.target.value as T)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ColorField({
  label,
  value,
  onCommit,
}: {
  label?: string;
  value: string;
  onCommit: (v: string) => void;
}) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      <input className="input" type="color" value={value} onChange={(e) => onCommit(e.target.value)} />
    </div>
  );
}

export function CheckRow({
  checked,
  onChange,
  title,
  subtitle,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  subtitle?: string;
}) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="txt">
        <b>{title}</b>
        {subtitle && <span>{subtitle}</span>}
      </span>
    </label>
  );
}
