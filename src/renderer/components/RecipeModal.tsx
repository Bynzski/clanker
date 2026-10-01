import { useState, useEffect } from 'react';
import {
  X,
  Play,
  Trash2,
  Edit2,
  Plus,
  Terminal as TermIcon,
  Bot,
  Globe,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react';
import type {
  WorkspaceRecipe,
  RecipeLaunchStep,
  RecipeLaunchResult,
  PersistedRecipeLayout,
} from '../../shared/types/recipes';
import { HARNESS_OPTIONS } from '../lib/harnessOptions';
import { Dialog, DialogContent, DialogTitle, DialogClose } from './ui/Dialog';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { Field, FieldLabel } from './ui/Field';
import './RecipeModal.css';
interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialRecipe?: WorkspaceRecipe | null;
  defaultWorkspacePath?: string;
  workspaceEnvironmentId?: string;
  defaultLaunches?: RecipeLaunchStep[];
  defaultBrowserUrl?: string;
  defaultLayout?: PersistedRecipeLayout;
  defaultTerminalCount?: number;
  onLaunchRecipe: (recipe: WorkspaceRecipe) => Promise<RecipeLaunchResult | null | void>;
  onRecipeSaved?: (recipe: WorkspaceRecipe) => void;
  onRecipeDeleted?: (recipeId: string) => void;
}

export default function RecipeModal({
  isOpen,
  onClose,
  initialRecipe,
  defaultWorkspacePath,
  workspaceEnvironmentId,
  defaultLaunches,
  defaultBrowserUrl,
  defaultLayout,
  defaultTerminalCount,
  onLaunchRecipe,
  onRecipeSaved,
  onRecipeDeleted,
}: Props) {
  const [isEditing, setIsEditing] = useState(!initialRecipe);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchResult, setLaunchResult] = useState<RecipeLaunchResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  // Form state
  const [name, setName] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [description, setDescription] = useState('');
  const [browserUrl, setBrowserUrl] = useState('');
  const [layout, setLayout] = useState<PersistedRecipeLayout | undefined>(initialRecipe?.layout ?? defaultLayout);
  const [terminalCount, setTerminalCount] = useState<number | undefined>(initialRecipe?.terminalCount ?? defaultTerminalCount);
  const [launches, setLaunches] = useState<RecipeLaunchStep[]>([]);

  useEffect(() => {
    if (!isOpen) {
      setLaunchResult(null);
      setErrorMessage('');
      return;
    }

    if (initialRecipe) {
      setIsEditing(false);
      setName(initialRecipe.name);
      setWorkspacePath(initialRecipe.workspacePath);
      setDescription(initialRecipe.description ?? '');
      setBrowserUrl(initialRecipe.browser?.url ?? '');
      setLayout(initialRecipe.layout);
      setTerminalCount(initialRecipe.terminalCount);
      setLaunches(initialRecipe.launches ?? []);
    } else {
      setIsEditing(true);
      setName('');
      setWorkspacePath(defaultWorkspacePath ?? '');
      setDescription('');
      setBrowserUrl(defaultBrowserUrl ?? '');
      setLayout(defaultLayout);
      setTerminalCount(defaultTerminalCount);
      setLaunches(defaultLaunches ?? [{ id: `step-${Date.now()}-1`, type: 'command', command: '' }]);
    }
  }, [isOpen, initialRecipe, defaultWorkspacePath, defaultLaunches, defaultBrowserUrl, defaultLayout, defaultTerminalCount]);

  if (!isOpen) return null;
  const remoteWorkspace = workspaceEnvironmentId != null && workspaceEnvironmentId !== 'local';
  const remoteRecipe = initialRecipe?.environmentId != null && initialRecipe.environmentId !== 'local';
  const recipeUnavailable = remoteWorkspace || remoteRecipe;
  const unavailableMessage = 'Launch recipes are not supported for SSH workspaces in this version.';


  const handleAddCommandStep = () => {
    setLaunches((prev) => [
      ...prev,
      { id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, type: 'command', command: '' },
    ]);
  };

  const handleAddShellStep = () => {
    setLaunches((prev) => [
      ...prev,
      { id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, type: 'shell' },
    ]);
  };

  const handleAddHarnessStep = () => {
    setLaunches((prev) => [
      ...prev,
      { id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, type: 'harness', harnessId: 'codex' },
    ]);
  };

  const handleRemoveStep = (index: number) => {
    setLaunches((prev) => prev.filter((_, i) => i !== index));
  };

  const handleStepChange = (index: number, step: RecipeLaunchStep) => {
    setLaunches((prev) => {
      const copy = [...prev];
      copy[index] = step;
      return copy;
    });
  };

  const handleSave = async () => {
    if (recipeUnavailable) {
      setErrorMessage(unavailableMessage);
      return;
    }
    if (!name.trim()) {
      setErrorMessage('Recipe name is required');
      return;
    }
    if (!workspacePath.trim()) {
      setErrorMessage('Workspace path is required');
      return;
    }

    const cleanedLaunches = launches.filter((s) => {
      if (s.type === 'shell') return true;
      if (s.type === 'command') return s.command.trim().length > 0;
      if (s.type === 'harness') return s.harnessId.trim().length > 0;
      return false;
    });

    const recipe: WorkspaceRecipe = {
      id: initialRecipe?.id ?? `recipe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(),
      workspacePath: workspacePath.trim(),
      environmentId: initialRecipe?.environmentId ?? 'local',
      terminalCount: terminalCount ?? (cleanedLaunches.length || 1),
      ...(description.trim() ? { description: description.trim() } : {}),
      launches: cleanedLaunches,
      ...(browserUrl.trim() ? { browser: { url: browserUrl.trim() } } : {}),
      ...(layout ? { layout } : {}),
      createdAt: initialRecipe?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      version: 1,
    };

    try {
      const saved = await window.electronAPI.recipeSave(recipe);
      onRecipeSaved?.(saved);
      setIsEditing(false);
      setErrorMessage('');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async () => {
    if (!initialRecipe?.id) return;
    if (!window.confirm(`Are you sure you want to delete the recipe "${initialRecipe.name}"?`)) {
      return;
    }

    try {
      const ok = await window.electronAPI.recipeDelete(initialRecipe.id);
      if (ok) {
        onRecipeDeleted?.(initialRecipe.id);
        onClose();
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleLaunch = async () => {
    if (recipeUnavailable) {
      setErrorMessage(unavailableMessage);
      return;
    }
    if (!initialRecipe) return;
    setIsLaunching(true);
    setErrorMessage('');
    try {
      const result = await onLaunchRecipe(initialRecipe);
      if (result) {
        setLaunchResult(result);
        if (result.success) {
          onClose();
        }
      } else {
        onClose();
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLaunching(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="recipe-modal" overlayClassName="recipe-modal-overlay" aria-describedby={undefined}>
        <div className="recipe-modal-header">
          <div className="recipe-modal-title-group">
            <DialogTitle asChild>
              <h2>{isEditing ? (initialRecipe ? 'Edit Launch Recipe' : 'New Launch Recipe') : name}</h2>
            </DialogTitle>
            {!isEditing && <span className="recipe-badge">{launches.length} steps</span>}
          </div>
          <DialogClose asChild>
            <IconButton aria-label="Close"><X size={18} /></IconButton>
          </DialogClose>
        </div>
        <div className="recipe-modal-body">
          {recipeUnavailable && (
            <div className="recipe-error-banner">
              <AlertTriangle size={16} />
              <span>{unavailableMessage}</span>
            </div>
          )}
          {errorMessage && (
            <div className="recipe-error-banner">
              <AlertTriangle size={16} />
              <span>{errorMessage}</span>
            </div>
          )}

          {launchResult && !launchResult.success && (
            <div className="recipe-launch-results-banner">
              <div className="recipe-launch-results-title">
                <AlertTriangle size={16} />
                <span>Some launch steps encountered errors:</span>
              </div>
              <ul className="recipe-launch-results-list">
                {launchResult.steps.map((step) => (
                  <li key={step.id} className={`recipe-step-status ${step.status}`}>
                    {step.status === 'success' ? <CheckCircle2 size={14} />
                      : step.status === 'started' ? <Loader2 size={14} /> : <XCircle size={14} />}
                    <span className="recipe-step-label">{step.type.toUpperCase()}:</span>
                    <span className="recipe-step-detail">{step.error ?? (step.status === 'started'
                      ? 'Command started; completion not verified' : 'Launched successfully')}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isEditing ? (
            <div className="recipe-form">
              <Field className="recipe-field">
                <FieldLabel htmlFor="recipe-name">Recipe Name</FieldLabel>
                <Input
                  id="recipe-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Full Stack Dev"
                />
              </Field>

              <Field className="recipe-field">
                <FieldLabel htmlFor="recipe-workspace-path">Workspace Path</FieldLabel>
                <Input
                  id="recipe-workspace-path"
                  value={workspacePath}
                  onChange={(e) => setWorkspacePath(e.target.value)}
                  placeholder="/path/to/project"
                />
              </Field>

              <Field className="recipe-field">
                <FieldLabel htmlFor="recipe-desc" optional>Description</FieldLabel>
                <Input
                  id="recipe-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Short note about this setup"
                />
              </Field>

              <Field className="recipe-field">
                <FieldLabel htmlFor="recipe-browser" optional>Browser Preview URL</FieldLabel>
                <Input
                  id="recipe-browser"
                  value={browserUrl}
                  onChange={(e) => setBrowserUrl(e.target.value)}
                  placeholder="http://localhost:3000"
                />
              </Field>
              <div className="recipe-steps-section">
                <div className="recipe-steps-header">
                  <label>Launch Steps</label>
                  <div className="recipe-add-step-buttons">
                    <Button size="sm" variant="secondary" className="recipe-add-btn" onClick={handleAddShellStep}>
                      <Plus size={14} /> Shell
                    </Button>
                    <Button size="sm" variant="secondary" className="recipe-add-btn" onClick={handleAddCommandStep}>
                      <Plus size={14} /> Command
                    </Button>
                    <Button size="sm" variant="secondary" className="recipe-add-btn" onClick={handleAddHarnessStep}>
                      <Plus size={14} /> Agent
                    </Button>
                  </div>
                </div>

                <div className="recipe-steps-list">
                  {launches.map((step, index) => (
                    <div key={step.id} className="recipe-step-row">
                      <span className="recipe-step-number">{index + 1}.</span>
                      {step.type === 'command' ? (
                        <div className="recipe-step-inputs">
                          <TermIcon size={14} className="recipe-step-type-icon" />
                          <Input
                            size="sm"
                            className="step-input"
                            value={step.command}
                            onChange={(e) => handleStepChange(index, { ...step, command: e.target.value })}
                            placeholder="Shell command (e.g. npm run dev)"
                          />
                        </div>
                      ) : step.type === 'shell' ? (
                        <div className="recipe-step-inputs">
                          <TermIcon size={14} className="recipe-step-type-icon" />
                          <span>Interactive shell</span>
                        </div>
                      ) : (
                        <div className="recipe-step-inputs">
                          <Bot size={14} className="recipe-step-type-icon" />
                          <Select
                            size="sm"
                            className="step-select"
                            value={step.harnessId}
                            onChange={(e) => handleStepChange(index, { ...step, harnessId: e.target.value })}
                          >
                            {HARNESS_OPTIONS.map((opt) => (
                              <option key={opt.id} value={opt.id}>
                                {opt.label}
                              </option>
                            ))}
                          </Select>
                          <Input
                            size="sm"
                            className="step-input"
                            value={step.modelId ?? ''}
                            onChange={(e) => handleStepChange(index, { ...step, modelId: e.target.value })}
                            placeholder="Model override (optional)"
                          />
                        </div>
                      )}
                      <IconButton
                        className="recipe-remove-step-btn"
                        onClick={() => handleRemoveStep(index)}
                        aria-label="Remove step"
                      >
                        <X size={14} />
                      </IconButton>
                    </div>
                  ))}
                  {launches.length === 0 && (
                    <div className="recipe-no-steps">No launch steps. Add a shell, command, or agent above.</div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="recipe-preview">
              {description && <p className="recipe-description">{description}</p>}

              <div className="recipe-preview-workspace">
                <span className="recipe-preview-label">Workspace:</span>
                <span className="recipe-preview-path">{workspacePath}</span>
              </div>
              {layout && (
                <div className="recipe-preview-workspace">
                  <span className="recipe-preview-label">Saved Layout:</span>
                  <span className="recipe-preview-path">
                    {layout.terminalCount} terminal pane{layout.terminalCount === 1 ? '' : 's'}
                    {layout.explorerVisible ? ' · Explorer' : ''}
                  </span>
                </div>
              )}

              <div className="recipe-preview-section">
                <span className="recipe-preview-label">Will launch:</span>
                <div className="recipe-preview-steps">
                  {launches.map((step, index) => (
                    <div key={step.id} className="recipe-preview-step-item">
                      <span className="recipe-preview-step-index">{index + 1}.</span>
                      {step.type === 'harness' ? (
                        <>
                          <Bot size={14} className="recipe-preview-icon bot" />
                          <span className="recipe-preview-text">
                            <strong>
                              {HARNESS_OPTIONS.find((h) => h.id === step.harnessId)?.label ?? step.harnessId}
                            </strong>
                            {step.modelId ? ` — model: ${step.modelId}` : ''}
                          </span>
                        </>
                      ) : step.type === 'shell' ? (
                        <>
                          <TermIcon size={14} className="recipe-preview-icon term" />
                          <span className="recipe-preview-text">Interactive shell</span>
                        </>
                      ) : (
                        <>
                          <TermIcon size={14} className="recipe-preview-icon term" />
                          <code className="recipe-preview-code">{step.command}</code>
                        </>
                      )}
                    </div>
                  ))}
                  {launches.length === 0 && (
                    <div className="recipe-preview-empty">Opens an interactive terminal.</div>
                  )}
                </div>
              </div>

              {browserUrl && (
                <div className="recipe-preview-browser">
                  <Globe size={14} className="recipe-preview-icon globe" />
                  <span className="recipe-preview-label">Browser:</span>
                  <span className="recipe-preview-url">{browserUrl}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="recipe-modal-footer">
          {isEditing ? (
            <div className="recipe-footer-actions">
              {initialRecipe && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setIsEditing(false)}
                >
                  Cancel
                </Button>
              )}
              <Button size="sm" variant="primary" onClick={handleSave} disabled={recipeUnavailable}>
                Save Recipe
              </Button>
            </div>
          ) : (
            <div className="recipe-footer-actions space-between">
              <Button
                size="sm"
                variant="danger"
                onClick={handleDelete}
                title="Delete this recipe"
              >
                <Trash2 size={14} /> Delete
              </Button>
              <div className="recipe-footer-right">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setIsEditing(true)}
                  disabled={recipeUnavailable}
                >
                  <Edit2 size={14} /> Edit
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  className="recipe-launch-btn"
                  onClick={handleLaunch}
                  disabled={isLaunching || recipeUnavailable}
                >
                  {isLaunching ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                  Launch Recipe
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
