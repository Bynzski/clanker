import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Check, ChevronDown, Loader2, Monitor, Plus, Search, Server, Settings } from 'lucide-react';
import type { SshEnvironmentConfig } from '../../../shared/types/environments';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/Popover';
import './WorkspaceTargetPicker.css';

interface Props {
  value: string;
  environments: SshEnvironmentConfig[];
  localRoot: string;
  settingsBusy: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
  onAddServer: () => void;
  onSettings: () => void;
}

/** A location is a machine with a starting directory, not a project catalog. */
export function WorkspaceTargetPicker({ value, environments, localRoot, settingsBusy, disabled,
  onSelect, onAddServer, onSettings }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const handingOff = useRef(false);
  const choicesRef = useRef(new Map<string, HTMLButtonElement>());
  const addRef = useRef<HTMLButtonElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const resultsId = useId();
  const selected = environments.find((environment) => environment.id === value);
  const name = value === 'local' ? 'This PC' : selected?.label ?? 'Choose a server';
  const SelectedIcon = value === 'local' ? Monitor : Server;
  const targets = [
    { id: 'local', name: 'This PC', detail: localRoot, Icon: Monitor },
    ...environments.map((environment) => ({
      id: environment.id, name: environment.label, detail: environment.target, Icon: Server,
    })),
  ].filter((target) => `${target.name} ${target.detail}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  const navigate = (event: KeyboardEvent, index?: number) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const buttons = [...targets.map((target) => choicesRef.current.get(target.id)), settingsRef.current, addRef.current];
    const next = index === undefined
      ? event.key === 'ArrowDown' ? 0 : buttons.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    const button = buttons[next]?.disabled ? addRef.current : buttons[next];
    button?.focus();
    button?.scrollIntoView?.({ block: 'nearest' });
  };

  return <div className="gate-target-picker">
      <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) { setQuery(''); handingOff.current = false; } }}>
        <PopoverTrigger asChild>
          <button ref={triggerRef} type="button" className="gate-target-trigger" aria-label={`Choose location: ${name}`} disabled={disabled || settingsBusy}>
            {settingsBusy ? <Loader2 size={13} className="spin" aria-hidden="true" /> : <SelectedIcon size={13} aria-hidden="true" />}
            <span className="gate-target-name">{name}</span>
            <ChevronDown size={12} aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="gate-target-popover" align="start" aria-label="Workspace locations"
          onCloseAutoFocus={(event) => { if (handingOff.current) event.preventDefault(); }}
          onOpenAutoFocus={(event) => { event.preventDefault(); searchRef.current?.focus(); }}>
          <div className="gate-target-search">
            <Search size={13} aria-hidden="true" />
            <Input ref={searchRef} type="search" role="searchbox" aria-label="Search locations" aria-controls={resultsId}
              placeholder="Search locations" value={query} onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => navigate(event)} />
          </div>
          <div id={resultsId} className="gate-target-list" role="group" aria-label="Locations">
            {!targets.length && <p className="gate-target-empty" role="status">No matching locations</p>}
            {targets.map((target, index) => <button key={target.id} type="button" className="gate-target-option"
              aria-label={`${target.name}${target.detail ? `, ${target.detail}` : ''}`}
              aria-pressed={value === target.id} onKeyDown={(event) => navigate(event, index)}
              ref={(button) => { if (button) choicesRef.current.set(target.id, button); else choicesRef.current.delete(target.id); }}
              onClick={() => { onSelect(target.id); setOpen(false); }}>
              <target.Icon size={14} aria-hidden="true" />
              <span className="gate-target-identity">
                <span>{target.name}</span>
                {target.detail && <span className="gate-target-detail" title={target.detail}>{target.detail}</span>}
              </span>
              {value === target.id && <Check size={13} className="gate-target-check" aria-hidden="true" />}
            </button>)}
          </div>
          <div className="gate-target-actions">
          <Button ref={settingsRef} type="button" className="gate-target-settings"
            aria-label={value === 'local' ? 'Set working directory for This PC' : `Settings for ${name}`}
            disabled={disabled || settingsBusy || (value !== 'local' && !selected)}
            onKeyDown={(event) => navigate(event, targets.length)} onClick={() => {
              handingOff.current = true;
              triggerRef.current?.focus();
              setOpen(false);
              onSettings();
            }}>
            <Settings size={14} aria-hidden="true" /> {value === 'local' ? 'Set working directory…' : 'Server settings…'}
          </Button>
          <Button ref={addRef} type="button" className="gate-target-add" onKeyDown={(event) => navigate(event, targets.length + 1)}
            onClick={() => {
              handingOff.current = true;
              triggerRef.current?.focus();
              setOpen(false);
              onAddServer();
            }}>
            <Plus size={14} aria-hidden="true" /> Add server…
          </Button>
          </div>
        </PopoverContent>
      </Popover>
  </div>;
}
