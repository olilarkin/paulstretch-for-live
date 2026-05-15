import { useRef, useState } from 'react';

interface Props {
  // Only used in standalone mode (no host injection); the extension dialog
  // hides the File button.
  onFile?: (file: File | undefined) => Promise<void>;
  showFile: boolean;
}

export function TitleBar({ onFile, showFile }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (onFile) await onFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="titlebar">
      <div className="titlebar-title">Paulstretch For Live</div>
      <div className="titlebar-menus">
        {showFile && (
          <>
            <button
              className="menu-button"
              onClick={() => fileInputRef.current?.click()}
              title="Load audio file"
            >
              File
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              style={{ display: 'none' }}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </>
        )}
        <button className="menu-button" onClick={() => setAboutOpen(true)}>
          About
        </button>
      </div>
      {aboutOpen && (
        <div className="modal-backdrop" onClick={() => setAboutOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Paulstretch For Live</h2>
            <div className="modal-subtitle">Paul's Extreme Sound Stretch For Ableton Live</div>
            <p className="about-version">Version {__APP_VERSION__}</p>
            <p>This is an experimental program for extreme stretching the audio.</p>
            <p>
              A port of{' '}
              <a href="https://hypermammut.sourceforge.net/paulstretch/" target="_blank" rel="noreferrer">Paulstretch</a>{' '}
              by{' '}
              <a href="https://www.paulnasca.com/" target="_blank" rel="noreferrer">Nasca Octavian Paul</a>, built on <code>libpaulstretch</code> by{' '}
              <a href="https://www.olilarkin.com/" target="_blank" rel="noreferrer">Oli Larkin</a>.
            </p>
            <p>
              Source:{' '}
              <a href="https://github.com/olilarkin/paulstretch-for-live" target="_blank" rel="noreferrer">
                github.com/olilarkin/paulstretch-for-live
              </a>
            </p>
            <p>License: GPL v2.0</p>
            <button onClick={() => setAboutOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
