import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { WorkspaceRecipe } from '../../../src/shared/types/recipes';
import RecipeModal from '../../../src/renderer/components/RecipeModal';
import { installElectronApiMock } from '../../setup/electron';

describe('RecipeModal', () => {
  const sampleRecipe: WorkspaceRecipe = {
    id: 'rec-test-1',
    name: 'Full Stack Recipe',
    workspacePath: '/projects/test-project',
    description: 'Dev server and agent',
    launches: [
      { id: 's1', type: 'harness', harnessId: 'codex', modelId: 'gpt-5' },
      { id: 's2', type: 'command', command: 'npm run dev' },
    ],
    browser: { url: 'http://localhost:5173' },
    createdAt: 1000,
    updatedAt: 1000,
    version: 1,
  };

  beforeEach(() => {
    installElectronApiMock();
  });
  it('does not save a path-only recipe while editing in an SSH workspace', () => {
    const saveMock = vi.fn();
    installElectronApiMock({ recipeSave: saveMock });
    render(<RecipeModal isOpen onClose={vi.fn()} defaultWorkspacePath="/home/user/project"
      workspaceEnvironmentId="dev-vps" onLaunchRecipe={vi.fn()} />);
    expect(screen.getByText('Launch recipes are not supported for SSH workspaces in this version.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Recipe' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save Recipe' }));
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('does not expose launch or editing of a persisted remote recipe', () => {
    const launch = vi.fn();
    render(<RecipeModal isOpen onClose={vi.fn()} initialRecipe={{ ...sampleRecipe, environmentId: 'dev-vps' }}
      onLaunchRecipe={launch} />);
    expect(screen.getByRole('button', { name: 'Launch Recipe' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(launch).not.toHaveBeenCalled();
  });


  it('renders preview mode with clear display of commands to be executed', () => {
    const onLaunch = vi.fn();
    render(
      <RecipeModal
        isOpen={true}
        onClose={vi.fn()}
        initialRecipe={sampleRecipe}
        onLaunchRecipe={onLaunch}
      />,
    );

    // Header & badge
    expect(screen.getByText('Full Stack Recipe')).toBeInTheDocument();
    expect(screen.getByText('2 steps')).toBeInTheDocument();

    // Workspace path
    expect(screen.getByText('/projects/test-project')).toBeInTheDocument();

    // Steps
    expect(screen.getByText(/Codex/)).toBeInTheDocument();
    expect(screen.getByText(/gpt-5/)).toBeInTheDocument();
    expect(screen.getByText('npm run dev')).toBeInTheDocument();

    // Browser URL
    expect(screen.getByText('http://localhost:5173')).toBeInTheDocument();

    // Launch button exists and has not been executed automatically
    expect(onLaunch).not.toHaveBeenCalled();
    const launchBtn = screen.getByRole('button', { name: /launch recipe/i });
    expect(launchBtn).toBeInTheDocument();
  });

  it('triggers onLaunchRecipe only on explicit user click', async () => {
    const onLaunch = vi.fn().mockResolvedValue({ success: true, recipeId: 'rec-test-1', steps: [] });
    const onClose = vi.fn();

    render(
      <RecipeModal
        isOpen={true}
        onClose={onClose}
        initialRecipe={sampleRecipe}
        onLaunchRecipe={onLaunch}
      />,
    );

    expect(onLaunch).not.toHaveBeenCalled();

    const launchBtn = screen.getByRole('button', { name: /launch recipe/i });
    fireEvent.click(launchBtn);

    await waitFor(() => {
      expect(onLaunch).toHaveBeenCalledWith(sampleRecipe);
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('displays partial launch failure banner when steps fail', async () => {
    const onLaunch = vi.fn().mockResolvedValue({
      recipeId: 'rec-test-1',
      success: false,
      steps: [
        { id: 's1', type: 'harness', status: 'success', terminalId: 't-1' },
        { id: 's2', type: 'command', status: 'failed', error: 'npm: command not found' },
        { id: 'browser', type: 'browser', status: 'failed', error: 'Connection refused' },
      ],
    });

    render(
      <RecipeModal
        isOpen={true}
        onClose={vi.fn()}
        initialRecipe={sampleRecipe}
        onLaunchRecipe={onLaunch}
      />,
    );

    const launchBtn = screen.getByRole('button', { name: /launch recipe/i });
    fireEvent.click(launchBtn);

    await waitFor(() => {
      expect(screen.getByText(/Some launch steps encountered errors/i)).toBeInTheDocument();
      expect(screen.getByText(/npm: command not found/i)).toBeInTheDocument();
      expect(screen.getByText(/Connection refused/i)).toBeInTheDocument();
    });
  });

  it('allows editing and saving a recipe', async () => {
    const onRecipeSaved = vi.fn();
    const saveMock = vi.fn().mockImplementation(async (r) => r);
    installElectronApiMock({
      recipeSave: saveMock,
    });

    render(
      <RecipeModal
        isOpen={true}
        onClose={vi.fn()}
        initialRecipe={sampleRecipe}
        onLaunchRecipe={vi.fn()}
        onRecipeSaved={onRecipeSaved}
      />,
    );

    // Switch to edit mode
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));

    const nameInput = screen.getByLabelText(/recipe name/i);
    fireEvent.change(nameInput, { target: { value: 'Renamed Recipe' } });

    fireEvent.click(screen.getByRole('button', { name: /save recipe/i }));

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalled();
      expect(onRecipeSaved).toHaveBeenCalled();
    });
  });

  it('saves captured shell and harness slots without filtering or reordering', async () => {
    const saveMock = vi.fn().mockImplementation(async (recipe) => recipe);
    installElectronApiMock({ recipeSave: saveMock });
    render(<RecipeModal isOpen={true} onClose={vi.fn()} defaultWorkspacePath="/projects/test-project"
      defaultTerminalCount={2} defaultLaunches={[
        { id: 's1', type: 'shell' }, { id: 's2', type: 'harness', harnessId: 'codex' },
      ]} onLaunchRecipe={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/recipe name/i), { target: { value: 'Mixed' } });
    expect(screen.getByText('Interactive shell')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /save recipe/i }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({
      terminalCount: 2,
      launches: [{ id: 's1', type: 'shell' }, { id: 's2', type: 'harness', harnessId: 'codex' }],
    })));
  });

  it('allows deleting a recipe with confirmation', async () => {
    const onDelete = vi.fn();
    const deleteMock = vi.fn().mockResolvedValue(true);
    installElectronApiMock({
      recipeDelete: deleteMock,
    });

    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <RecipeModal
        isOpen={true}
        onClose={vi.fn()}
        initialRecipe={sampleRecipe}
        onLaunchRecipe={vi.fn()}
        onRecipeDeleted={onDelete}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith('rec-test-1');
      expect(onDelete).toHaveBeenCalledWith('rec-test-1');
    });
  });

  it('dismisses modal on Close button click and Escape key', () => {
    const onClose = vi.fn();
    render(
      <RecipeModal
        isOpen={true}
        onClose={onClose}
        initialRecipe={sampleRecipe}
        onLaunchRecipe={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Full Stack Recipe' });
    expect(dialog).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('supports editing harness step select options and model override', () => {
    render(
      <RecipeModal
        isOpen={true}
        onClose={vi.fn()}
        defaultLaunches={[{ id: 'step-1', type: 'harness', harnessId: 'codex', modelId: 'gpt-4o' }]}
        onLaunchRecipe={vi.fn()}
      />,
    );

    const select = screen.getByRole('combobox');
    expect(select).toHaveValue('codex');
    fireEvent.change(select, { target: { value: 'claude' } });
    expect(select).toHaveValue('claude');

    const modelInput = screen.getByPlaceholderText('Model override (optional)');
    expect(modelInput).toHaveValue('gpt-4o');
    fireEvent.change(modelInput, { target: { value: 'claude-3-7-sonnet' } });
    expect(modelInput).toHaveValue('claude-3-7-sonnet');
  });
});
