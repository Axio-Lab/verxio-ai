"use client";

import { useEffect, useRef, useState } from "react";
import { AppWindow, FolderOpen, MessageSquare, Monitor, MousePointer2, Terminal } from "lucide-react";

function useInView(threshold = 0.08) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setVisible(true);
      },
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);
  return { ref, visible };
}

function useCardHover() {
  const [hovered, setHovered] = useState(false);
  return {
    hovered,
    handlers: { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) },
  };
}

function Tags({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-2 mt-4">
      {items.map((tag) => (
        <span
          key={tag}
          className="px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200 text-[11px] font-medium text-gray-600 hover:border-primary/30 hover:bg-primary/5 transition-colors cursor-default"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function ComputerUseVisual({ active }: { active: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-gray-50/80 p-4 min-h-[196px]">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-gray-300" />
        <span className="h-2 w-2 rounded-full bg-gray-200" />
        <span className="h-2 w-2 rounded-full bg-gray-200" />
        <span className="ml-2 h-2 w-24 rounded-full bg-gray-200" />
      </div>
      <div className="mt-5 space-y-2.5">
        <div className="h-2 w-4/5 rounded-full bg-gray-200" />
        <div className="h-2 w-3/5 rounded-full bg-gray-200" />
        <div
          className={`mt-4 inline-flex h-8 items-center rounded-lg border px-3 text-[11px] font-medium transition-colors duration-500 ${
            active ? "border-primary/40 bg-primary/10 text-primary" : "border-gray-200 bg-white text-gray-500"
          }`}
        >
          Send invite
        </div>
      </div>
      <div
        className="pointer-events-none absolute transition-all duration-700 ease-out"
        style={{
          left: active ? "46%" : "18%",
          top: active ? "58%" : "28%",
        }}
      >
        <MousePointer2 className="h-4 w-4 fill-gray-900 text-gray-900 drop-shadow-sm" />
        <span
          className={`absolute -left-2 -top-2 h-8 w-8 rounded-full border border-primary/50 transition-opacity duration-300 ${
            active ? "opacity-100" : "opacity-0"
          }`}
        />
      </div>
      <p className="absolute bottom-3 left-4 text-[10px] font-medium text-gray-400">
        {active ? "Sent the invite" : "Watching the screen"}
      </p>
    </div>
  );
}

function WorkspaceVisual({ active }: { active: boolean }) {
  const panes = [
    { icon: MessageSquare, label: "Chat", detail: "Draft the reply" },
    { icon: FolderOpen, label: "Files", detail: "Documents/Verxio" },
    { icon: Terminal, label: "Terminal", detail: "verxio status" },
  ];
  return (
    <div className="grid gap-2">
      {panes.map((pane, i) => {
        const Icon = pane.icon;
        return (
          <div
            key={pane.label}
            className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all duration-500 ${
              active ? "border-primary/20 bg-primary/[0.04]" : "border-gray-100 bg-gray-50/80"
            }`}
            style={{ transitionDelay: active ? `${i * 120}ms` : "0ms" }}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white border border-gray-100">
              <Icon className="h-3.5 w-3.5 text-primary" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-800">{pane.label}</p>
              <p className="text-[10px] text-gray-400">{pane.detail}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NotepadVisual({ active }: { active: boolean }) {
  const lines = ["Screen recording", "Whisper on this machine", "Transcript in the note"];
  return (
    <div className="mt-5 space-y-2">
      {lines.map((line, i) => (
        <div
          key={line}
          className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2"
          style={{
            opacity: active ? 1 : 0.45,
            transform: active ? "translateY(0)" : "translateY(6px)",
            transition: `all 0.45s ease ${i * 140}ms`,
          }}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${i === 2 && active ? "bg-primary" : "bg-gray-300"}`} />
          <span className="text-xs text-gray-600">{line}</span>
        </div>
      ))}
    </div>
  );
}

function ProjectsVisual({ active }: { active: boolean }) {
  const folders = [
    { name: "Tech Team", count: "4" },
    { name: "Youtube Transcribe", count: "2" },
    { name: "Client notes", count: "6" },
  ];
  return (
    <div className="mt-5 space-y-2">
      {folders.map((folder, i) => (
        <div
          key={folder.name}
          className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2"
          style={{
            opacity: active ? 1 : 0,
            transition: `opacity 0.4s ease ${i * 120}ms`,
          }}
        >
          <span className="flex items-center gap-2 text-xs text-gray-700">
            <FolderOpen className="h-3.5 w-3.5 text-primary" strokeWidth={1.75} />
            {folder.name}
          </span>
          <span className="text-[10px] tabular-nums text-gray-400">{folder.count}</span>
        </div>
      ))}
    </div>
  );
}

function MessagingVisual({ active }: { active: boolean }) {
  const messages = [
    { from: "you", text: "Tell them the proposal is ready." },
    { from: "agent", text: "Sent on Telegram." },
  ];
  return (
    <div className="mt-5 space-y-2">
      {messages.map((msg, i) => {
        const isAgent = msg.from === "agent";
        return (
          <div
            key={msg.text}
            className={`flex ${isAgent ? "justify-start" : "justify-end"}`}
            style={{
              opacity: active ? 1 : 0,
              transform: active ? "translateY(0)" : "translateY(6px)",
              transition: `all 0.4s ease ${i * 180}ms`,
            }}
          >
            <div
              className={`max-w-[88%] rounded-2xl px-3 py-2 text-[11px] text-gray-700 ${
                isAgent ? "rounded-tl-sm border border-primary/10 bg-primary/5" : "rounded-tr-sm bg-gray-100"
              }`}
            >
              {msg.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const wideCardClass =
  "group md:col-span-2 lg:col-span-3 rounded-2xl border border-gray-200/80 bg-gradient-to-r from-white to-primary/[0.02] p-6 sm:p-7 transition-all duration-700 hover:shadow-lg hover:border-primary/25";
const cardClass =
  "group rounded-2xl border border-gray-200/80 bg-white p-6 sm:p-7 transition-all duration-700 hover:shadow-lg hover:border-primary/20";

export function Features() {
  const section = useInView(0.06);
  const computer = useCardHover();
  const workspace = useCardHover();
  const notepad = useCardHover();
  const projects = useCardHover();
  const messaging = useCardHover();
  const reveal = section.visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6";

  return (
    <section id="features" className="py-24 bg-white" ref={section.ref}>
      <div className="mx-auto max-w-6xl px-6">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold tracking-wide mb-4">
            On your machine
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 tracking-tight">
            One agent for the
            <span className="text-primary"> work in front of you</span>
          </h2>
          <p className="mt-4 text-lg text-gray-500">
            Computer use, your files, the terminal, Notepad, and the apps and channels you already
            use.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div {...computer.handlers} className={`${wideCardClass} ${reveal}`} style={{ transitionDelay: "0ms" }}>
            <div className="grid sm:grid-cols-2 gap-6 items-center">
              <div>
                <div className="flex items-start gap-4">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform duration-300">
                    <Monitor className="w-5 h-5 text-primary" strokeWidth={1.5} />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-gray-900 tracking-tight">Computer use</h3>
                    <p className="mt-1 text-sm text-gray-500 leading-relaxed">
                      The agent sees your screen and uses the mouse and keyboard in other apps, after
                      you allow it.
                    </p>
                  </div>
                </div>
                <Tags items={["See the screen", "Move the cursor", "Type and click", "macOS, Windows, Linux"]} />
              </div>
              <ComputerUseVisual active={computer.hovered || section.visible} />
            </div>
          </div>

          <div {...workspace.handlers} className={`${wideCardClass} ${reveal}`} style={{ transitionDelay: "80ms" }}>
            <div className="grid sm:grid-cols-2 gap-6 items-center">
              <div>
                <div className="flex items-start gap-4">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform duration-300">
                    <AppWindow className="w-5 h-5 text-primary" strokeWidth={1.5} />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-gray-900 tracking-tight">The workspace</h3>
                    <p className="mt-1 text-sm text-gray-500 leading-relaxed">
                      Chat, your files, and the terminal sit together. The default folder is
                      Documents/Verxio.
                    </p>
                  </div>
                </div>
                <Tags items={["Chat", "Local files", "Terminal", "Projects"]} />
              </div>
              <WorkspaceVisual active={workspace.hovered || section.visible} />
            </div>
          </div>

          <div {...notepad.handlers} className={`${cardClass} ${reveal}`} style={{ transitionDelay: "140ms" }}>
            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform duration-300">
                <Monitor className="w-5 h-5 text-primary" strokeWidth={1.5} />
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900 tracking-tight">Notepad and Whisper</h3>
                <p className="mt-1 text-sm text-gray-500 leading-relaxed">
                  Record the screen or the mic. Whisper transcribes it on the machine.
                </p>
              </div>
            </div>
            <NotepadVisual active={notepad.hovered || section.visible} />
          </div>

          <div {...projects.handlers} className={`${cardClass} ${reveal}`} style={{ transitionDelay: "180ms" }}>
            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform duration-300">
                <FolderOpen className="w-5 h-5 text-primary" strokeWidth={1.5} />
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900 tracking-tight">Projects</h3>
                <p className="mt-1 text-sm text-gray-500 leading-relaxed">
                  File chats into folders, then scroll and reorder them in the sidebar.
                </p>
              </div>
            </div>
            <ProjectsVisual active={projects.hovered || section.visible} />
          </div>

          <div {...messaging.handlers} className={`${cardClass} ${reveal}`} style={{ transitionDelay: "220ms" }}>
            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform duration-300">
                <MessageSquare className="w-5 h-5 text-primary" strokeWidth={1.5} />
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900 tracking-tight">Messaging</h3>
                <p className="mt-1 text-sm text-gray-500 leading-relaxed">
                  Telegram, WhatsApp, Slack, and Discord from the same agent.
                </p>
              </div>
            </div>
            <MessagingVisual active={messaging.hovered || section.visible} />
          </div>
        </div>
      </div>
    </section>
  );
}
