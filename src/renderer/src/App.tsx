import React, { useState, useEffect } from 'react';
import { useAuth } from './hooks/useAuth';
import { useSyncState } from './hooks/useSyncState';
import { ConnectScreen } from './screens/ConnectScreen';
import { DestinationScreen } from './screens/DestinationScreen';
import { DashboardScreen } from './screens/DashboardScreen';
import { Footer } from './components/Footer';
import { AboutModal } from './components/AboutModal';

export default function App(): React.JSX.Element {
  const { loading, signedIn, account, quota, signOut, refreshStatus } = useAuth();
  const { syncState, syncProgress, logs, driveStatus } = useSyncState();
  const [destinationPath, setDestinationPath] = useState<string | null>(null);
  const [checkingDest, setCheckingDest] = useState(true);
  const [isAboutOpen, setIsAboutOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = window.onesync.onOpenAbout?.(() => {
      setIsAboutOpen(true);
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    async function loadCurrentDestination(): Promise<void> {
      try {
        const dest = await window.onesync.getCurrentDestination();
        setDestinationPath(dest);
      } catch {
        setDestinationPath(null);
      } finally {
        setCheckingDest(false);
      }
    }
    loadCurrentDestination();
  }, []);

  const handleDestinationConfirmed = async (): Promise<void> => {
    const dest = await window.onesync.getCurrentDestination();
    setDestinationPath(dest);
  };

  const handleChangeFolder = async (): Promise<void> => {
    setDestinationPath(null);
    await window.onesync.clearDestination();
  };

  const handleSignOut = async (): Promise<void> => {
    await signOut();
    setDestinationPath(null);
  };

  if (loading || checkingDest) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-app)',
          color: 'var(--text-secondary)',
          fontSize: '0.9rem'
        }}
      >
        Initializing OneSync…
      </div>
    );
  }

  let content: React.JSX.Element;

  if (!signedIn || !account) {
    content = <ConnectScreen onConnected={refreshStatus} />;
  } else if (!destinationPath) {
    content = (
      <DestinationScreen
        account={account}
        quota={quota}
        onDestinationConfirmed={handleDestinationConfirmed}
        onSignOut={handleSignOut}
      />
    );
  } else {
    content = (
      <DashboardScreen
        account={account}
        quota={quota}
        destinationPath={destinationPath}
        syncState={syncState}
        syncProgress={syncProgress}
        logs={logs}
        driveStatus={driveStatus}
        onChangeFolder={handleChangeFolder}
        onSignOut={handleSignOut}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <header className="app-titlebar">
        <div
          className="no-drag"
          onClick={() => setIsAboutOpen(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer'
          }}
          title="About OneSync"
        >
          <img
            src="/icon.png"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
            alt="OneSync"
            style={{ width: '18px', height: '18px', borderRadius: '4px', objectFit: 'contain' }}
          />
          <span style={{ fontWeight: 600 }}>OneSync</span>
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {account ? account.email : 'OneDrive Mirror'}
        </div>
      </header>
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {content}
      </main>
      <Footer />
      <AboutModal isOpen={isAboutOpen} onClose={() => setIsAboutOpen(false)} />
    </div>
  );
}
