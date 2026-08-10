import { useEffect, useState } from 'react';
import type { CaptureSettings } from '@seorak/types';
import { DEFAULT_CAPTURE_SETTINGS } from '@seorak/types';
import { fetchCaptureSettings } from '../lib/api.js';
import { isDemoActive } from '../lib/demoMode.js';

/**
 * The active capture settings, fetched once on mount. Returns null until the
 * fetch resolves, then the real settings (or DEFAULT_CAPTURE_SETTINGS on failure
 * or in demo mode, so widget-readiness gating never blocks on a network error).
 * Extracted from the two dashboard shells, which held identical copies (D6).
 */
export function useCaptureSettings(): CaptureSettings | null {
  const [captureSettings, setCaptureSettings] = useState<CaptureSettings | null>(null);

  useEffect(() => {
    if (isDemoActive()) {
      setCaptureSettings(DEFAULT_CAPTURE_SETTINGS);
      return;
    }
    const controller = new AbortController();
    fetchCaptureSettings({ signal: controller.signal })
      .then(setCaptureSettings)
      .catch(() => setCaptureSettings(DEFAULT_CAPTURE_SETTINGS));
    return () => controller.abort();
  }, []);

  return captureSettings;
}
