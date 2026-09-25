import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { audio } from "../game/audio";
import type { Contract, EntranceId, IncidentReport, MissionResult, SaveGame, Settings } from "../game/types";
import { applyResult, hasSave, loadSave, newSave, wipeSave, writeSave } from "../game/world";
import Briefing from "./Briefing";
import GameView from "./GameView";
import Hub from "./Hub";
import MainMenu from "./MainMenu";
import Report from "./Report";
import SettingsPanel from "./SettingsPanel";

type Screen =
  | { id: "boot" } | { id: "menu" } | { id: "hub"; tab?: string } | { id: "briefing"; contract: Contract }
  | { id: "loading"; contract: Contract; entry: EntranceId } | { id: "game"; contract: Contract; entry: EntranceId }
  | { id: "report"; report: IncidentReport; fresh: boolean };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ id: "boot" });
  const [save, setSave] = useState<SaveGame | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const saveRef = useRef<SaveGame | null>(null);
  saveRef.current = save;

  const persist = useCallback((s: SaveGame) => {
    const copy = structuredClone(s);
    setSave(copy);
    if (!writeSave(copy)) setNotice("Progress couldn't be saved: browser storage is unavailable. You can keep playing, but it won't persist.");
    return copy;
  }, []);

  useEffect(() => {
    const { save: s, error } = loadSave();
    if (error) setNotice(error);
    let loaded = s;
    // a mission that never finished (tab closed, crash) counts as a lost signal
    if (loaded && loaded.inMission) {
      const c = loaded.contracts.find(c => c.id === loaded!.inMission!.contractId);
      if (c) {
        const lost: MissionResult = { outcome: "aborted", objectiveDone: false, optionalsDone: [], loot: [], entry: loaded.facilities[c.facility].lastEntry ?? "main", alarms: 0, lockdown: false,
          kills: 0, kos: 0, camerasDestroyed: [], camerasEmped: 0, breaches: [], headshots: 0, dronesLost: 0, loopedFeeds: false, panelsSabotaged: 0, chief: "untouched", explored: loaded.facilities[c.facility].explored,
          events: [{ time: 0, text: "Operative signal lost. No further contact.", tone: "dim" }], duration: 0, zeroHourPassed: false, shotsFired: 0, hostageRescued: false, spotted: 0 };
        applyResult(loaded, c, lost);
        setNotice("Your last mission was interrupted. OVERWATCH logged it as a lost signal: nothing gained, nothing lost.");
      } else loaded.inMission = null;
      writeSave(loaded);
    }
    setSave(loaded);
    if (loaded) audio.applySettings(loaded.settings);
    const t = setTimeout(() => setScreen({ id: "menu" }), 700);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 7000); return () => clearTimeout(t); }, [notice]);

  const [looseSettings, setLooseSettings] = useState<Settings | null>(null);
  const settings = save?.settings;
  const updateSettings = (s: Settings) => {
    audio.applySettings(s);
    if (saveRef.current) persist({ ...saveRef.current, settings: s });
    else setLooseSettings(s);
  };

  const startNew = () => {
    audio.ensure(); audio.startAmbience(); audio.play("uiConfirm");
    const s = newSave();
    if (looseSettings) s.settings = looseSettings;
    persist(s);
    setScreen({ id: "hub", tab: "contracts" });
  };
  const cont = () => { audio.ensure(); audio.startAmbience(); audio.play("uiConfirm"); setScreen({ id: "hub" }); };

  const deploy = (contract: Contract, entry: EntranceId) => {
    if (!save) return;
    const s = persist({ ...save, inMission: { contractId: contract.id, started: Date.now() } });
    void s;
    setScreen({ id: "loading", contract, entry });
    setTimeout(() => setScreen({ id: "game", contract, entry }), 1300);
  };

  const onMissionEnd = (contract: Contract, result: MissionResult) => {
    const s = structuredClone(saveRef.current!);
    const report = applyResult(s, contract, result);
    persist(s);
    setScreen({ id: "report", report, fresh: true });
  };

  const resetAll = () => {
    wipeSave();
    setSave(null);
    setScreen({ id: "menu" });
    setSettingsOpen(false);
    setNotice("Progress wiped. The world has forgotten you.");
  };

  const effSettings: Settings = settings ?? looseSettings ?? { master: 0.8, sfx: 0.9, ambience: 0.7, shake: true, effects: true, hints: true };

  return (
    <ErrorBoundary onReset={() => setScreen({ id: "menu" })}>
      {screen.id === "boot" && <div className="screen boot"><div className="boot-logo">BLACKSITE</div></div>}
      {screen.id === "menu" && (
        <MainMenu canContinue={!!save && hasSave()} save={save} onNew={startNew} onContinue={cont}
          onSettings={() => setSettingsOpen(true)} settings={effSettings} />
      )}
      {screen.id === "hub" && save && (
        <Hub save={save} initialTab={screen.tab} persist={persist}
          onContract={c => { audio.play("uiConfirm"); setScreen({ id: "briefing", contract: c }); }}
          onReport={r => setScreen({ id: "report", report: r, fresh: false })}
          onMenu={() => setScreen({ id: "menu" })} onSettings={() => setSettingsOpen(true)} />
      )}
      {screen.id === "briefing" && save && (
        <Briefing save={save} contract={screen.contract} persist={persist} onBack={() => setScreen({ id: "hub", tab: "contracts" })} onDeploy={deploy} />
      )}
      {screen.id === "loading" && <Loading contract={screen.contract} />}
      {screen.id === "game" && save && (
        <GameView key={screen.contract.id + screen.entry} save={save} contract={screen.contract} entry={screen.entry} settings={effSettings}
          onEnd={r => onMissionEnd(screen.contract, r)} onSettings={() => setSettingsOpen(true)} />
      )}
      {screen.id === "report" && save && (
        <Report report={screen.report} fresh={screen.fresh} save={save} onContinue={() => { audio.menuMood(); setScreen({ id: "hub", tab: screen.fresh ? "contracts" : "records" }); }} />
      )}
      {settingsOpen && <SettingsPanel settings={effSettings} onChange={updateSettings} onClose={() => setSettingsOpen(false)} onReset={save ? resetAll : undefined} />}
      {notice && <div className="notice" role="status">{notice}</div>}
    </ErrorBoundary>
  );
}

function Loading({ contract }: { contract: Contract }) {
  const lines = ["Establishing uplink", "Pulling facility schematics", "Syncing with OVERWATCH", "Inserting"];
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI(v => Math.min(lines.length - 1, v + 1)), 320); return () => clearInterval(t); }, []);
  return (
    <div className="screen loading fade-in">
      <div className="label">{contract.title}</div>
      <div className="bar"><i /></div>
      <div className="mono dim">{lines[i]}…</div>
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode; onReset: () => void }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="screen boot">
        <div className="errbox">
          <div className="label">Signal interrupted</div>
          <h2 className="h1" style={{ marginTop: 8 }}>Something went wrong</h2>
          <p className="dim">Your progress is saved up to the last completed mission.</p>
          <button className="btn primary" onClick={() => { this.setState({ err: null }); this.props.onReset(); }}>Return to menu</button>
        </div>
      </div>
    );
  }
}
