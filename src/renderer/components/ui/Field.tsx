import type { ComponentProps } from 'react';
import './Input.css';

export type FieldProps = ComponentProps<'div'>;

/** Semantic container grouping a label, control, and optional message. */
export function Field({ className = '', ...props }: FieldProps) {
  return <div className={`clanker-field ${className}`} {...props} />;
}

export type FieldLabelProps = ComponentProps<'label'> & {
  optional?: boolean;
};

/** Label with centralized typography and optional indicator. */
export function FieldLabel({ className = '', optional = false, children, ...props }: FieldLabelProps) {
  return (
    <label className={`clanker-field-label ${className}`} {...props}>
      {children}
      {optional && <span className="clanker-field-optional"> (optional)</span>}
    </label>
  );
}

export type InputGroupProps = ComponentProps<'div'>;

/** Layout wrapper for inputs with leading/trailing icons or action buttons. */
export function InputGroup({ className = '', ...props }: InputGroupProps) {
  return <div className={`clanker-input-group ${className}`} {...props} />;
}

export type FormMessageProps = ComponentProps<'p'> & {
  variant?: 'description' | 'error';
};

/** Validation message or helper text with centralized status colors. */
export function FormMessage({
  variant = 'description',
  className = '',
  ...props
}: FormMessageProps) {
  return (
    <p
      className={`clanker-form-message ${className}`}
      data-variant={variant}
      role={variant === 'error' ? 'alert' : undefined}
      {...props}
    />
  );
}
