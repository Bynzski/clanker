import { createRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from '../../../src/renderer/components/ui/Input';
import { Textarea } from '../../../src/renderer/components/ui/Textarea';
import { Select } from '../../../src/renderer/components/ui/Select';
import { Field, FieldLabel, InputGroup, FormMessage } from '../../../src/renderer/components/ui/Field';

describe('Input', () => {
  it('renders standard input with ref and handles text typing', async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLInputElement>();
    const onChange = vi.fn();
    render(<Input ref={ref} placeholder="Enter name" onChange={onChange} />);
    const input = screen.getByPlaceholderText('Enter name');
    expect(ref.current).toBe(input);
    expect(input).toHaveClass('clanker-input');
    expect(input).toHaveAttribute('data-size', 'sm');
    expect(input).toHaveAttribute('data-variant', 'default');

    await user.type(input, 'test-val');
    expect(onChange).toHaveBeenCalled();
    expect(input).toHaveValue('test-val');
  });

  it('supports size and variant configuration', () => {
    render(<Input size="md" variant="mono" className="custom-input" aria-label="Branch" />);
    const input = screen.getByRole('textbox', { name: 'Branch' });
    expect(input).toHaveAttribute('data-size', 'md');
    expect(input).toHaveAttribute('data-variant', 'mono');
    expect(input).toHaveClass('clanker-input', 'custom-input');
  });

  it('reflects invalid state via isInvalid or aria-invalid', () => {
    const { rerender } = render(<Input isInvalid aria-label="Field 1" />);
    expect(screen.getByRole('textbox', { name: 'Field 1' })).toHaveAttribute('aria-invalid', 'true');

    rerender(<Input aria-invalid="true" aria-label="Field 1" />);
    expect(screen.getByRole('textbox', { name: 'Field 1' })).toHaveAttribute('aria-invalid', 'true');

    rerender(<Input aria-label="Field 1" />);
    expect(screen.getByRole('textbox', { name: 'Field 1' })).not.toHaveAttribute('aria-invalid');
  });

  it('respects disabled and read-only states', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Input disabled placeholder="Disabled" onChange={onChange} />);
    const input = screen.getByPlaceholderText('Disabled');
    expect(input).toBeDisabled();
    await user.type(input, 'abc');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Textarea', () => {
  it('renders textarea with ref and handles typing', async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLTextAreaElement>();
    render(<Textarea ref={ref} placeholder="Commit description" variant="mono" isInvalid />);
    const textarea = screen.getByPlaceholderText('Commit description');
    expect(ref.current).toBe(textarea);
    expect(textarea).toHaveClass('clanker-textarea');
    expect(textarea).toHaveAttribute('data-variant', 'mono');
    expect(textarea).toHaveAttribute('aria-invalid', 'true');

    await user.type(textarea, 'Multiline\ncommit');
    expect(textarea).toHaveValue('Multiline\ncommit');
  });
});

describe('Select', () => {
  it('renders select with options and handles value change', async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLSelectElement>();
    function Wrapper() {
      const [value, setValue] = useState('dark');
      return (
        <Select ref={ref} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Theme">
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="slate">Slate</option>
        </Select>
      );
    }
    render(<Wrapper />);
    const select = screen.getByRole('combobox', { name: 'Theme' });
    expect(ref.current).toBe(select);
    expect(select).toHaveClass('clanker-select');
    expect(select).toHaveValue('dark');

    await user.selectOptions(select, 'light');
    expect(select).toHaveValue('light');
  });

  it('supports size and invalid props', () => {
    render(<Select size="md" isInvalid aria-label="Model" />);
    const select = screen.getByRole('combobox', { name: 'Model' });
    expect(select).toHaveAttribute('data-size', 'md');
    expect(select).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('Field and FieldLabel', () => {
  it('renders structured field with label, input, and messages', () => {
    render(
      <Field className="recipe-field">
        <FieldLabel htmlFor="workspace-path" optional>
          Workspace Path
        </FieldLabel>
        <Input id="workspace-path" placeholder="/home/user/project" />
        <FormMessage variant="description">Path to repository.</FormMessage>
        <FormMessage variant="error">Directory does not exist.</FormMessage>
      </Field>
    );

    expect(screen.getByText('Workspace Path')).toBeInTheDocument();
    expect(screen.getByText('(optional)')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('/home/user/project')).toBeInTheDocument();

    const desc = screen.getByText('Path to repository.');
    expect(desc).toHaveAttribute('data-variant', 'description');
    expect(desc).not.toHaveAttribute('role', 'alert');

    const err = screen.getByText('Directory does not exist.');
    expect(err).toHaveAttribute('data-variant', 'error');
    expect(err).toHaveAttribute('role', 'alert');
  });

  it('renders InputGroup wrapper for custom action layout', () => {
    render(
      <InputGroup className="search-group">
        <Input placeholder="Search files" />
        <button type="button">Clear</button>
      </InputGroup>
    );
    expect(screen.getByPlaceholderText('Search files')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });
});
