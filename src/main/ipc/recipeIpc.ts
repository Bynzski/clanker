import { ipcMain } from 'electron';
import type Store from 'electron-store';
import type { StoreSchema } from '../../shared/types/store';
import {
  RECIPE_GET_ALL,
  RECIPE_SAVE,
  RECIPE_DELETE,
} from '../../shared/ipcChannels';
import { WorkspacePersistenceService } from '../workspacePersistence';
import { toNativePath } from '../../shared/pathNormalize';

export interface RegisterRecipeIpcDeps {
  getStore: () => Store<StoreSchema>;
  getSafeWorkspacePath?: (workingDir: string) => string;
}

export function registerRecipeIpc(deps: RegisterRecipeIpcDeps): WorkspacePersistenceService {
  const { getStore, getSafeWorkspacePath } = deps;
  const persistence = new WorkspacePersistenceService(getStore);

  ipcMain.handle(RECIPE_GET_ALL, async (_, workspacePath?: string) => {
    if (workspacePath && typeof workspacePath === 'string' && workspacePath.trim()) {
      return persistence.getRecipesForWorkspace(workspacePath);
    }
    return persistence.getAllRecipes();
  });

  ipcMain.handle(RECIPE_SAVE, async (_, recipeInput: unknown) => {
    if (typeof recipeInput !== 'object' || recipeInput === null) {
      throw new Error('Invalid recipe payload');
    }
    const input = recipeInput as Record<string, unknown>;
    if (getSafeWorkspacePath && typeof input.workspacePath === 'string') {
      const nativePath = toNativePath(input.workspacePath, process.platform);
      getSafeWorkspacePath(nativePath);
    }
    return persistence.saveRecipe(recipeInput);
  });

  ipcMain.handle(RECIPE_DELETE, async (_, recipeId: string) => {
    if (typeof recipeId !== 'string' || !recipeId.trim()) {
      return false;
    }
    return persistence.deleteRecipe(recipeId.trim());
  });

  return persistence;
}
