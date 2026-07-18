const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, WebContentsView } = require('electron');

const probeProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'clanker-gpu-smoke-'));
app.setPath('userData', probeProfile);

app.on('quit', () => {
  try {
    fs.rmSync(probeProfile, { recursive: true, force: true });
  } catch (error) {
    console.warn(`Could not remove temporary GPU profile ${probeProfile}:`, error);
  }
});

async function runGpuSmokeTest() {
  await app.whenReady();

  let gpuInfoError = null;
  try {
    await app.getGPUInfo('basic');
  } catch (error) {
    gpuInfoError = error instanceof Error ? error.message : String(error);
  }

  const hostWindow = new BrowserWindow({ show: false });
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });
  hostWindow.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 32, height: 32 });

  await view.webContents.loadURL(
    'data:text/html,<canvas id="webgl"></canvas><canvas id="webgl2"></canvas>',
  );
  const contexts = await view.webContents.executeJavaScript(`(() => {
    const webgl = document.getElementById('webgl').getContext('webgl');
    const webgl2 = document.getElementById('webgl2').getContext('webgl2');
    const rendererInfo = webgl?.getExtension('WEBGL_debug_renderer_info');

    return {
      webgl: Boolean(webgl),
      webgl2: Boolean(webgl2),
      renderer: webgl && rendererInfo
        ? webgl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL)
        : null,
      vendor: webgl && rendererInfo
        ? webgl.getParameter(rendererInfo.UNMASKED_VENDOR_WEBGL)
        : null,
    };
  })()`);

  const featureStatus = app.getGPUFeatureStatus();
  const passed = app.isHardwareAccelerationEnabled()
    && featureStatus.webgl.startsWith('enabled')
    && contexts.webgl
    && contexts.webgl2;

  console.log(JSON.stringify({
    passed,
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    hardwareAccelerationEnabled: app.isHardwareAccelerationEnabled(),
    gpuInfoError,
    featureStatus,
    contexts,
  }, null, 2));

  hostWindow.destroy();
  app.exit(passed ? 0 : 1);
}

runGpuSmokeTest().catch((error) => {
  console.error(error);
  app.exit(1);
});
