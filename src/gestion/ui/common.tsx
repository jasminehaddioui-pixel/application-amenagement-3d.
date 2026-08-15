/** Briques d'interface communes au module de gestion. */

import { useEffect, useState, type ReactNode } from 'react';

// ------------------------------------------------------------------ champs

export function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div className="g-field">
      <label>{label}</label>
      {children}
      {help && <span className="g-help">{help}</span>}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  disabled,
  type = 'text',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  type?: string;
}) {
  return (
    <input
      className="g-input"
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * Saisie numerique qui laisse taper. On ne reformate pas sous les doigts :
 * la valeur remonte a chaque frappe valide, le champ garde le texte saisi.
 */
export function NumberInput({
  value,
  onChange,
  step = 'any',
  min,
  disabled,
  placeholder,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: string | number;
  min?: number;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState(String(value ?? 0));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(value === 0 ? '0' : String(value));
  }, [value, focused]);

  return (
    <input
      className="g-input g-num"
      type="number"
      step={step}
      min={min}
      disabled={disabled}
      placeholder={placeholder}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        const n = Number(text.replace(',', '.'));
        setText(String(Number.isFinite(n) ? n : 0));
      }}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value.replace(',', '.'));
        if (Number.isFinite(n)) onChange(n);
        else if (e.target.value === '') onChange(0);
      }}
    />
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  disabled?: boolean;
}) {
  return (
    <select
      className="g-select"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Check({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="g-row" style={{ cursor: disabled ? 'default' : 'pointer', marginBottom: 8 }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
      />
      <span style={{ fontSize: 12 }}>{label}</span>
    </label>
  );
}

// ------------------------------------------------------------------ fenetres

export function Modal({
  title,
  children,
  onClose,
  footer,
  wide,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn ghost" onClick={onClose} title="Fermer">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Confirmation d'une action irreversible. Pour les plus graves, on exige la
 * saisie d'un mot de confirmation : un clic distrait ne suffit pas.
 */
export function Confirm({
  title,
  message,
  confirmWord,
  danger,
  confirmLabel = 'Confirmer',
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmWord?: string;
  danger?: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const ready = !confirmWord || typed.trim().toUpperCase() === confirmWord.toUpperCase();

  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            Annuler
          </button>
          <button
            type="button"
            className={danger ? 'btn danger' : 'btn primary'}
            disabled={!ready}
            onClick={() => {
              onConfirm();
              onCancel();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>{message}</div>
      {confirmWord && (
        <div style={{ marginTop: 12 }}>
          <Field label={`Tapez « ${confirmWord} » pour confirmer`}>
            <TextInput value={typed} onChange={setTyped} placeholder={confirmWord} />
          </Field>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ divers

export function Empty({ icon = '∅', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="g-empty">
      <span className="big">{icon}</span>
      <div style={{ fontWeight: 600, color: 'var(--text-dim)' }}>{title}</div>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Card({
  k,
  v,
  d,
  tone,
}: {
  k: string;
  v: ReactNode;
  d?: ReactNode;
  tone?: 'good' | 'warn' | 'bad' | 'accent';
}) {
  return (
    <div className={`g-card ${tone ?? ''}`}>
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {d && <div className="d">{d}</div>}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="g-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** Encadre d'avertissement : sert notamment aux reserves comptables. */
export function NoticeBox({
  tone = 'warn',
  title,
  children,
}: {
  tone?: 'warn' | 'info' | 'danger';
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`g-notice-box ${tone === 'warn' ? '' : tone}`}>
      {title && <b>{title}</b>}
      {children}
    </div>
  );
}
