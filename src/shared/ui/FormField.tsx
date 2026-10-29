import { cloneElement, isValidElement, useId, type ReactNode } from 'react';
import { cn } from './cn';

type FormFieldProps = {
  label: ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function FormField({ label, htmlFor, required, hint, error, children, className }: FormFieldProps) {
  const generatedId = useId();
  const nativeControl = isValidElement<{ id?: string }>(children) && typeof children.type === 'string' && ['input', 'select', 'textarea'].includes(children.type);
  const controlId = htmlFor || (nativeControl ? children.props.id || generatedId : undefined);
  return (
    <div className={cn('ui-form-field', className)}>
      <label htmlFor={controlId} className="ui-form-field__label">
        {label}{required && <span aria-hidden="true" className="ui-form-field__required"> *</span>}
      </label>
      {nativeControl ? cloneElement(children, { id: controlId }) : children}
      {error ? <p className="ui-form-field__error">{error}</p> : hint ? <p className="ui-form-field__hint">{hint}</p> : null}
    </div>
  );
}
