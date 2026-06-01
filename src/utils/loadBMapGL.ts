const BAIDU_MAP_AK = 'lQXHeOGPjI7YxGTZb3wIoOLk21HTulxv';
const BMAP_GL_SCRIPT_ID = 'cloud-drive-bmapgl-sdk';
const BMAP_GL_FALLBACK_SCRIPT_ID = 'cloud-drive-bmapgl-sdk-fallback';
const BMAP_GL_CSS_ID = 'cloud-drive-bmapgl-css';
const BMAP_GL_CALLBACK = '__cloudDriveBMapGLLoaded';
const BMAP_GL_GETSCRIPT_VERSION = '20260506102102';
const FALLBACK_DELAY_MS = 8000;

declare global {
  interface Window {
    __cloudDriveBMapGLPromise?: Promise<void>;
    __cloudDriveBMapGLLoaded?: () => void;
  }
}

function isBMapGLReady(browserWindow: Window & { BMapGL?: unknown }) {
  const bmap = browserWindow.BMapGL as { Map?: unknown; Point?: unknown } | undefined;
  return Boolean(bmap && typeof bmap.Map === 'function' && typeof bmap.Point === 'function');
}

function ensureBMapGLCss() {
  if (document.getElementById(BMAP_GL_CSS_ID)) return;

  const link = document.createElement('link');
  link.id = BMAP_GL_CSS_ID;
  link.rel = 'stylesheet';
  link.type = 'text/css';
  link.href = 'https://api.map.baidu.com/res/webgl/10/bmap.css';
  document.head.appendChild(link);
}

export function loadBMapGL(timeoutMs = 30000): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Baidu Map can only be loaded in the browser'));
  }

  const browserWindow = window as Window & { BMapGL?: unknown };

  if (isBMapGLReady(browserWindow)) return Promise.resolve();
  if (window.__cloudDriveBMapGLPromise) return window.__cloudDriveBMapGLPromise;

  window.__cloudDriveBMapGLPromise = new Promise<void>((resolve, reject) => {
    let settled = false;
    const scriptSrc = `https://api.map.baidu.com/api?type=webgl&v=1.0&ak=${BAIDU_MAP_AK}&callback=${BMAP_GL_CALLBACK}`;
    const fallbackScriptSrc =
      `https://api.map.baidu.com/getscript?type=webgl&v=1.0&ak=${BAIDU_MAP_AK}&services=&t=${BMAP_GL_GETSCRIPT_VERSION}`;
    let script = document.getElementById(BMAP_GL_SCRIPT_ID) as HTMLScriptElement | null;
    let fallbackScript = document.getElementById(BMAP_GL_FALLBACK_SCRIPT_ID) as HTMLScriptElement | null;

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      window.clearTimeout(fallbackTimerId);
      script?.removeEventListener('error', handleError);
      fallbackScript?.removeEventListener('error', handleError);
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      window.__cloudDriveBMapGLPromise = undefined;

      if (!isBMapGLReady(browserWindow)) {
        script?.remove();
        fallbackScript?.remove();
      }

      reject(error);
    };

    function handleLoad() {
      if (isBMapGLReady(browserWindow)) {
        finish();
        return;
      }

      fail(new Error('Baidu Map GL API callback fired but BMapGL is unavailable'));
    }

    function handleError() {
      fail(new Error('Baidu Map GL API failed to load'));
    }

    function loadFallbackScript() {
      if (settled || isBMapGLReady(browserWindow)) {
        finish();
        return;
      }

      ensureBMapGLCss();
      fallbackScript = document.getElementById(BMAP_GL_FALLBACK_SCRIPT_ID) as HTMLScriptElement | null;
      if (fallbackScript) return;

      fallbackScript = document.createElement('script');
      fallbackScript.id = BMAP_GL_FALLBACK_SCRIPT_ID;
      fallbackScript.async = true;
      fallbackScript.src = fallbackScriptSrc;
      fallbackScript.addEventListener('error', handleError);
      document.head.appendChild(fallbackScript);
    }

    const timeoutId = window.setTimeout(() => {
      fail(new Error(`Baidu Map GL API load timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const fallbackTimerId = window.setTimeout(loadFallbackScript, Math.min(FALLBACK_DELAY_MS, timeoutMs - 1000));

    window.__cloudDriveBMapGLLoaded = handleLoad;
    browserWindow.BMapGL = browserWindow.BMapGL || {};
    (browserWindow.BMapGL as { apiLoad?: () => void }).apiLoad = handleLoad;

    if (!script) {
      script = document.createElement('script');
      script.id = BMAP_GL_SCRIPT_ID;
      script.async = true;
      script.defer = true;
      script.src = scriptSrc;
      script.addEventListener('error', handleError);
      document.head.appendChild(script);
      return;
    }

    script.addEventListener('error', handleError);
  });

  return window.__cloudDriveBMapGLPromise;
}
