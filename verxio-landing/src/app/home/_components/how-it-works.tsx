"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  AppWindow,
  ArrowRight,
  Bot,
  CheckCircle2,
  FolderOpen,
  Link2,
  MessageSquare,
  Monitor,
  Send,
  Terminal,
} from "lucide-react";

import { appPath } from "@/lib/site";

interface TabContent {
  id: string;
  label: string;
  icon: React.ElementType;
  headline: string;
  description: string;
  steps: { text: string; icon: React.ElementType }[];
  visual: {
    type: "flow" | "cards" | "chat" | "timeline";
    items: { label: string; sublabel?: string; status?: "done" | "active" | "pending" }[];
  };
}

const TAB_DURATION = 6000;

const TABS: TabContent[] = [
  {
    id: "workspace",
    label: "Workspace",
    icon: MessageSquare,
    headline: "Ask in the workspace.",
    description:
      "The desktop app is the place you talk to the agent. Chats stay in projects, and the work shows up beside the conversation.",
    steps: [
      { text: "Open Verxio on your machine", icon: Monitor },
      { text: "Ask in plain language", icon: MessageSquare },
      { text: "File the chat into a project", icon: FolderOpen },
      { text: "Come back to the same thread later", icon: Send },
    ],
    visual: {
      type: "chat",
      items: [
        { label: "You", sublabel: "Draft the reply from the notes in Tech Team.", status: "done" },
        { label: "Verxio", sublabel: "Read three notes. Draft is in the workspace.", status: "active" },
      ],
    },
  },
  {
    id: "computer",
    label: "Computer",
    icon: Monitor,
    headline: "It uses your computer.",
    description:
      "Computer use lets the agent see the screen and use the mouse and keyboard in other apps, after you allow it.",
    steps: [
      { text: "Allow screen and accessibility access", icon: Monitor },
      { text: "The agent looks at the app you have open", icon: AppWindow },
      { text: "It moves, types, and clicks", icon: Bot },
      { text: "You see the finished action", icon: CheckCircle2 },
    ],
    visual: {
      type: "flow",
      items: [
        { label: "Calendar open", sublabel: "On your screen", status: "done" },
        { label: "Invite filled", sublabel: "Cursor and keyboard", status: "done" },
        { label: "Send clicked", sublabel: "In the calendar app", status: "active" },
      ],
    },
  },
  {
    id: "files",
    label: "Files",
    icon: FolderOpen,
    headline: "It uses your files and terminal.",
    description:
      "The agent reads the workspace on your machine, previews files, and runs commands in the terminal next to the chat.",
    steps: [
      { text: "Work starts in Documents/Verxio", icon: FolderOpen },
      { text: "The agent reads and writes local files", icon: AppWindow },
      { text: "Commands run in the built-in terminal", icon: Terminal },
      { text: "Notepad recordings transcribe on device", icon: Bot },
    ],
    visual: {
      type: "timeline",
      items: [
        { label: "Documents/Verxio", sublabel: "Workspace folder", status: "done" },
        { label: "notes.md", sublabel: "Read in the sidebar", status: "done" },
        { label: "verxio status", sublabel: "Terminal", status: "active" },
      ],
    },
  },
  {
    id: "channels",
    label: "Apps",
    icon: Link2,
    headline: "It reaches your apps and channels.",
    description:
      "Connect Gmail, GitHub, Calendar, and the rest of your tools. The same agent can reply on Telegram, WhatsApp, Slack, and Discord.",
    steps: [
      { text: "Connect the apps you already use", icon: Link2 },
      { text: "Turn on Telegram, WhatsApp, Slack, or Discord", icon: MessageSquare },
      { text: "Ask once in the workspace", icon: Bot },
      { text: "The agent acts in the app or channel", icon: Send },
    ],
    visual: {
      type: "cards",
      items: [
        { label: "Gmail", sublabel: "Unread threads", status: "done" },
        { label: "GitHub", sublabel: "Pull request", status: "done" },
        { label: "Telegram", sublabel: "Reply sent", status: "active" },
        { label: "Slack", sublabel: "Connected", status: "pending" },
      ],
    },
  },
];

function FlowVisual({
  items,
  animate,
}: {
  items: TabContent["visual"]["items"];
  animate: boolean;
}) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div
          key={item.label}
          className="flex items-center gap-3"
          style={{
            opacity: animate ? 1 : 0,
            transform: animate ? "translateX(0)" : "translateX(16px)",
            transition: `all 0.5s cubic-bezier(0.16,1,0.3,1) ${i * 120}ms`,
          }}
        >
          <div
            className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold ${
              item.status === "done"
                ? "bg-primary/10 text-primary"
                : item.status === "active"
                  ? "bg-amber-50 text-amber-600 ring-2 ring-amber-200"
                  : "bg-gray-100 text-gray-400"
            }`}
          >
            {item.status === "done" ? (
              <CheckCircle2 className="w-5 h-5" />
            ) : item.status === "active" ? (
              <div className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
            ) : (
              <div className="w-2 h-2 rounded-full bg-gray-300" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{item.label}</p>
            <p className="text-xs text-gray-500 truncate">{item.sublabel}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function TimelineVisual({
  items,
  animate,
}: {
  items: TabContent["visual"]["items"];
  animate: boolean;
}) {
  return (
    <div className="relative">
      <div
        className="absolute left-[19px] top-2 bottom-2 w-px bg-gradient-to-b from-primary/40 via-primary/20 to-gray-200 origin-top"
        style={{
          transform: animate ? "scaleY(1)" : "scaleY(0)",
          transition: "transform 0.8s cubic-bezier(0.16,1,0.3,1)",
        }}
      />
      <div className="space-y-4">
        {items.map((item, i) => (
          <div
            key={item.label}
            className="flex items-start gap-4"
            style={{
              opacity: animate ? 1 : 0,
              transform: animate ? "translateY(0)" : "translateY(12px)",
              transition: `all 0.5s cubic-bezier(0.16,1,0.3,1) ${i * 150 + 200}ms`,
            }}
          >
            <div
              className={`relative z-10 h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${
                item.status === "done"
                  ? "bg-primary text-white"
                  : item.status === "active"
                    ? "bg-white border-2 border-primary text-primary"
                    : "bg-gray-100 text-gray-400"
              }`}
            >
              {item.status === "done" ? (
                <CheckCircle2 className="w-5 h-5" />
              ) : item.status === "active" ? (
                <div className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
              ) : (
                <div className="w-2 h-2 rounded-full bg-gray-300" />
              )}
            </div>
            <div className="pt-1.5">
              <p className="text-sm font-semibold text-gray-900">{item.label}</p>
              <p className="text-xs text-gray-500">{item.sublabel}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChatVisual({
  items,
  animate,
}: {
  items: TabContent["visual"]["items"];
  animate: boolean;
}) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => {
        const isAgent = item.label === "AI Agent";
        return (
          <div
            key={`${item.label}-${i}`}
            className={`flex ${isAgent ? "justify-start" : "justify-end"}`}
            style={{
              opacity: animate ? 1 : 0,
              transform: animate ? "translateY(0) scale(1)" : `translateY(8px) scale(0.95)`,
              transition: `all 0.4s cubic-bezier(0.16,1,0.3,1) ${i * 180}ms`,
            }}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                isAgent
                  ? "bg-primary/5 border border-primary/10 rounded-tl-sm"
                  : "bg-gray-100 rounded-tr-sm"
              }`}
            >
              <p
                className={`text-[10px] font-semibold mb-0.5 ${isAgent ? "text-primary" : "text-gray-400"}`}
              >
                {item.label}
              </p>
              <p className="text-sm text-gray-700 leading-relaxed">{item.sublabel}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CardsVisual({
  items,
  animate,
}: {
  items: TabContent["visual"]["items"];
  animate: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((item, i) => (
        <div
          key={item.label}
          className={`rounded-xl border p-3.5 ${
            item.status === "done"
              ? "border-primary/20 bg-primary/[0.03]"
              : item.status === "active"
                ? "border-amber-200 bg-amber-50/50"
                : "border-gray-200 bg-gray-50"
          }`}
          style={{
            opacity: animate ? 1 : 0,
            transform: animate ? "scale(1)" : "scale(0.85)",
            transition: `all 0.4s cubic-bezier(0.16,1,0.3,1) ${i * 100}ms`,
          }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <div
              className={`w-2 h-2 rounded-full ${
                item.status === "done"
                  ? "bg-primary"
                  : item.status === "active"
                    ? "bg-amber-500 animate-pulse"
                    : "bg-gray-300"
              }`}
            />
            <p className="text-sm font-medium text-gray-900">{item.label}</p>
          </div>
          <p className="text-xs text-gray-500">{item.sublabel}</p>
        </div>
      ))}
    </div>
  );
}

function VisualRenderer({ visual, animate }: { visual: TabContent["visual"]; animate: boolean }) {
  switch (visual.type) {
    case "flow":
      return <FlowVisual items={visual.items} animate={animate} />;
    case "timeline":
      return <TimelineVisual items={visual.items} animate={animate} />;
    case "chat":
      return <ChatVisual items={visual.items} animate={animate} />;
    case "cards":
      return <CardsVisual items={visual.items} animate={animate} />;
  }
}

export function HowItWorks() {
  const [activeTab, setActiveTab] = useState(0);
  const [animate, setAnimate] = useState(true);
  const [isVisible, setIsVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const sectionRef = useRef<HTMLDivElement>(null);
  const autoplayRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.15 }
    );
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  const startAutoplay = useCallback(() => {
    if (autoplayRef.current) clearInterval(autoplayRef.current);
    if (progressRef.current) clearInterval(progressRef.current);
    setProgress(0);

    const progressTick = 50;
    progressRef.current = setInterval(() => {
      setProgress((p) => Math.min(p + (progressTick / TAB_DURATION) * 100, 100));
    }, progressTick);

    autoplayRef.current = setInterval(() => {
      setAnimate(false);
      setProgress(0);
      setTimeout(() => {
        setActiveTab((prev) => (prev + 1) % TABS.length);
        setAnimate(true);
      }, 150);
    }, TAB_DURATION);
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    startAutoplay();
    return () => {
      if (autoplayRef.current) clearInterval(autoplayRef.current);
      if (progressRef.current) clearInterval(progressRef.current);
    };
  }, [isVisible, startAutoplay]);

  const handleTabClick = (index: number) => {
    if (autoplayRef.current) clearInterval(autoplayRef.current);
    if (progressRef.current) clearInterval(progressRef.current);
    setAnimate(false);
    setProgress(0);
    setTimeout(() => {
      setActiveTab(index);
      setAnimate(true);
      startAutoplay();
    }, 150);
  };

  const tab = TABS[activeTab];

  return (
    <section id="how-it-works" className="py-24 bg-gray-50/80" ref={sectionRef}>
      <div className="mx-auto max-w-6xl px-6">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold tracking-wide mb-4">
            How It Works
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 tracking-tight">
            Ask once. <span className="text-primary">The agent does the work.</span>
          </h2>
          <p className="mt-4 text-lg text-gray-500">
            From the workspace on your machine to the apps and channels you already use.
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="flex flex-wrap justify-center gap-2 mb-12">
          {TABS.map((t, i) => {
            const Icon = t.icon;
            const isActive = activeTab === i;
            return (
              <button
                key={t.id}
                onClick={() => handleTabClick(i)}
                className={`relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 overflow-hidden ${
                  isActive
                    ? "bg-primary text-white shadow-md shadow-primary/20"
                    : "bg-white text-gray-600 border border-gray-200 hover:border-primary/30 hover:text-gray-900"
                }`}
              >
                {isActive && (
                  <div
                    className="absolute bottom-0 left-0 h-[3px] bg-white/30 rounded-full"
                    style={{ width: `${progress}%`, transition: "width 50ms linear" }}
                  />
                )}
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content Area */}
        <div
          className={`transition-all duration-700 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <div className="grid lg:grid-cols-2 gap-10 items-start">
            {/* Left: Steps */}
            <div
              style={{
                opacity: animate ? 1 : 0,
                transform: animate ? "translateX(0)" : "translateX(-16px)",
                transition: "all 0.5s cubic-bezier(0.16,1,0.3,1)",
              }}
            >
              <h3 className="text-2xl font-bold text-gray-900 mb-3 tracking-tight">
                {tab.headline}
              </h3>
              <p className="text-gray-500 mb-8 leading-relaxed">{tab.description}</p>

              {/* Steps with connecting line */}
              <div className="relative">
                <div
                  className="absolute left-[19px] top-5 bottom-5 w-px bg-gradient-to-b from-primary/20 via-primary/10 to-transparent origin-top"
                  style={{
                    transform: animate ? "scaleY(1)" : "scaleY(0)",
                    transition: "transform 0.8s cubic-bezier(0.16,1,0.3,1) 0.2s",
                  }}
                />
                <div className="space-y-5">
                  {tab.steps.map((step, i) => {
                    const StepIcon = step.icon;
                    return (
                      <div
                        key={step.text}
                        className="flex items-start gap-4 relative"
                        style={{
                          opacity: animate ? 1 : 0,
                          transform: animate ? "translateY(0)" : "translateY(10px)",
                          transition: `all 0.5s cubic-bezier(0.16,1,0.3,1) ${i * 120 + 100}ms`,
                        }}
                      >
                        <div className="relative z-10 flex items-center justify-center h-10 w-10 rounded-xl bg-primary/10 text-primary shrink-0">
                          <StepIcon className="w-5 h-5" />
                        </div>
                        <div className="pt-1">
                          <span className="text-[10px] font-bold text-primary/50 tracking-widest">
                            STEP {String(i + 1).padStart(2, "0")}
                          </span>
                          <p className="text-sm text-gray-700 font-medium mt-0.5">{step.text}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div
                className="mt-8"
                style={{ opacity: animate ? 1 : 0, transition: "opacity 0.4s ease 0.6s" }}
              >
                <a
                  href={appPath("/download")}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary/80 transition-colors group"
                >
                  Download Verxio
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </a>
              </div>
            </div>

            {/* Right: Visual */}
            <div
              className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-sm"
              style={{
                opacity: animate ? 1 : 0,
                transform: animate ? "translateX(0) scale(1)" : "translateX(16px) scale(0.98)",
                transition: "all 0.5s cubic-bezier(0.16,1,0.3,1) 0.1s",
              }}
            >
              {/* Visual header */}
              <div className="flex items-center gap-2 mb-5 pb-4 border-b border-gray-100">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-400/60" />
                </div>
                <span className="text-xs text-gray-400 font-mono ml-2">verxio / {tab.id}</span>
                <div className="ml-auto flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[10px] text-gray-400">Live</span>
                </div>
              </div>

              <VisualRenderer visual={tab.visual} animate={animate} />
            </div>
          </div>
        </div>

        {/* Progress indicators */}
        <div className="flex justify-center gap-1.5 mt-10">
          {TABS.map((_, i) => (
            <button
              key={i}
              onClick={() => handleTabClick(i)}
              className="relative h-1.5 rounded-full overflow-hidden transition-all duration-500"
              style={{
                width: activeTab === i ? 32 : 6,
                backgroundColor: activeTab === i ? "transparent" : "#d1d5db",
              }}
              aria-label={`Go to tab ${i + 1}`}
            >
              {activeTab === i && (
                <>
                  <div className="absolute inset-0 bg-primary/20 rounded-full" />
                  <div
                    className="absolute inset-y-0 left-0 bg-primary rounded-full"
                    style={{ width: `${progress}%`, transition: "width 50ms linear" }}
                  />
                </>
              )}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
