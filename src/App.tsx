import { useEffect, useRef, useState } from "react";
import { Button } from "./components/ui";
import { Stage } from "./components/Stage";
import { Timeline } from "./components/Timeline";
import { Transport } from "./components/Transport";
import { ClipPanel } from "./components/ClipPanel";
import { ModePanel } from "./components/ModePanel";
import { AlignPanel } from "./components/AlignPanel";
import { AnnotationPanel } from "./components/AnnotationPanel";
import { CountInPanel } from "./components/CountInPanel";
import { TrimPanel } from "./components/TrimPanel";
import { ExportPanel } from "./components/ExportPanel";
import { usePlaybackEngine } from "./hooks/usePlaybackEngine";
import { useMetronome } from "./hooks/useMetronome";
import { DESKTOP_QUERY, useMediaQuery } from "./hooks/useMediaQuery";
import { useProject } from "./store/useProject";

type TabId = "clips" | "mode" | "align" | "trim" | "text" | "export";

const TABS: { id: TabId; label: string }[] = [
  { id: "clips", label: "影片" },
  { id: "mode", label: "版面" },
  { id: "align", label: "對齊" },
  { id: "trim", label: "剪輯" },
  { id: "text", label: "標註" },
  { id: "export", label: "匯出" },
];

export default function App() {
  const refs = useRef({
    a: { current: null as HTMLVideoElement | null },
    b: { current: null as HTMLVideoElement | null },
  }).current;

  usePlaybackEngine(refs);
  useMetronome();

  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [tab, setTab] = useState<TabId>("clips");
  // 面板收起來,舞台高度大約多一倍 —— 看動作的時候不需要面板佔著
  const [panelOpen, setPanelOpen] = useState(true);
  const clipsLoaded = useProject((s) => Boolean(s.clips.a && s.clips.b));

  const adjustTarget = useProject((s) => s.adjustTarget);
  const setAdjustTarget = useProject((s) => s.setAdjustTarget);

  const onTabClick = (id: TabId) => {
    if (id === tab) setPanelOpen((open) => !open);
    else {
      setTab(id);
      setPanelOpen(true);
    }
  };

  // 手勢調整時面板一定要讓開:開關按鈕在面板裡,但要調的東西在舞台上,
  // 面板佔著的話舞台只剩幾十 px,根本看不到自己在調什麼
  useEffect(() => {
    if (adjustTarget) setPanelOpen(false);
  }, [adjustTarget]);

  const panels = {
    clips: (
      <>
        <ClipPanel id="a" />
        <ClipPanel id="b" />
      </>
    ),
    mode: <ModePanel />,
    align: <AlignPanel />,
    trim: (
      <>
        <CountInPanel />
        <TrimPanel />
      </>
    ),
    text: <AnnotationPanel />,
    export: <ExportPanel refs={refs} />,
  };

  if (isDesktop) {
    return (
      <div className="flex h-full flex-col">
        <Header />
        <main className="flex min-h-0 flex-1 gap-3 p-3">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Stage refs={refs} />
            <Transport />
            <Timeline />
          </div>
          <aside className="w-85 shrink-0 space-y-3 overflow-y-auto">
            <ModePanel />
            <ClipPanel id="a" />
            <ClipPanel id="b" />
            <AlignPanel />
            <CountInPanel />
            <TrimPanel />
            <AnnotationPanel />
            <ExportPanel refs={refs} />
          </aside>
        </main>
      </div>
    );
  }

  // 手機版:舞台固定在上方不捲走,操作面板用分頁收納,
  // 否則六個面板疊起來要滑很久才看得到匯出。
  return (
    <div className="flex h-full flex-col">
      <Header />

      {/* 舞台吃掉面板以外的所有剩餘空間,Stage 自己會 contain 到不擠壓下面的控制列 */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 border-b border-white/10 px-3 pt-2 pb-3">
        <Stage refs={refs} />
        {adjustTarget ? (
          <div className="flex items-center gap-2 rounded-md bg-indigo-500/15 px-2 py-1.5 ring-1 ring-indigo-400/40">
            <span className="text-[11px] text-indigo-200">
              拖曳移動畫面 · 兩指捏合縮放
            </span>
            <Button className="ml-auto" onClick={() => setAdjustTarget(null)}>
              完成
            </Button>
          </div>
        ) : (
          <Transport />
        )}
        <Timeline />
      </div>

      <nav className="flex shrink-0 border-b border-white/10">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onTabClick(t.id)}
              aria-expanded={active ? panelOpen : undefined}
              className={`min-h-11 flex-1 touch-manipulation text-xs font-medium transition ${
                active && panelOpen
                  ? "border-b-2 border-indigo-400 text-white"
                  : "text-white/45"
              }`}
            >
              {t.label}
              {active && (
                <span className="ml-1 text-[9px]">{panelOpen ? "▾" : "▴"}</span>
              )}
              {t.id === "align" && clipsLoaded && !active && (
                <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-indigo-400 align-middle" />
              )}
            </button>
          );
        })}
      </nav>

      {/* 面板固定佔畫面下半的一部分,不跟舞台搶 flex-1,否則切到內容多的分頁舞台會被壓扁 */}
      {panelOpen && (
        <main className="max-h-[45dvh] shrink-0 space-y-3 overflow-y-auto p-3">
          {panels[tab]}
        </main>
      )}
    </div>
  );
}

function Header() {
  return (
    <header className="flex shrink-0 items-baseline gap-2 border-b border-white/10 px-3 py-2">
      <h1 className="text-sm font-semibold">Cover影片製作工具</h1>
    </header>
  );
}
