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
});
