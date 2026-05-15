import { useEffect } from 'react';
import { useStore } from '../state/store';
import type { ActiveTab } from '../types';

const TABS_ALL: ActiveTab[] = ['Parameters', 'Process', 'Binaural beats', 'Write to file'];
const TABS_HOST: ActiveTab[] = ['Parameters', 'Process', 'Binaural beats'];

interface Props {
  hostMode: boolean;
}

export function Tabs({ hostMode }: Props) {
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const tabs = hostMode ? TABS_HOST : TABS_ALL;

  // If we mounted in host mode but the persisted active tab is "Write to file"
  // (e.g. set in a previous dev session), snap back to Parameters.
  useEffect(() => {
    if (hostMode && !tabs.includes(activeTab)) setActiveTab('Parameters');
  }, [hostMode, activeTab, tabs, setActiveTab]);

  return (
    <div className="tabs">
      {tabs.map((tab) => (
        <button
          key={tab}
          className={'tab' + (activeTab === tab ? ' active' : '')}
          onClick={() => setActiveTab(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
