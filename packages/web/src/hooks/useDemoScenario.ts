// React binding for the demo-scenario URL param. Hooks subscribe to the
// custom 'seorak:demo-scenario-changed' event so a switcher swap causes
// every dashboard hook to re-derive its fixture in lockstep. Avoids
// routing the scenario through a global store - the URL is already the
// source of truth, and React's re-render tree is cheap enough at demo
// scale.

import { useEffect, useState } from 'react';
import { getActiveScenarioId, isDemoActive } from '../lib/demoMode.js';
import type { DemoScenarioId } from '../lib/demo/index.js';

interface DemoScenarioState {
  active: boolean;
  scenarioId: DemoScenarioId;
}

function snapshot(): DemoScenarioState {
  return { active: isDemoActive(), scenarioId: getActiveScenarioId() };
}

export function useDemoScenario(): DemoScenarioState {
  const [state, setState] = useState<DemoScenarioState>(snapshot);
  useEffect(() => {
    function handler() {
      setState(snapshot());
    }
    window.addEventListener('seorak:demo-scenario-changed', handler);
    // popstate fires on browser navigation; keep the demo param in sync if
    // the user manually edits the URL.
    window.addEventListener('popstate', handler);
    return () => {
      window.removeEventListener('seorak:demo-scenario-changed', handler);
      window.removeEventListener('popstate', handler);
    };
  }, []);
  return state;
}
